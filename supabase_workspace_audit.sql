-- =============================================================================
-- COVALENCE — WORKSPACE DATA + AUDIT LOG
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run. Safe to re-run.
-- Run AFTER supabase_auth.sql.
-- =============================================================================
-- 1. workspace_kv: everything that used to live only in one browser (settings,
--    Triage log, DFA portfolio, Trio playbooks/debriefs, Duo session list, Desk
--    stage history) is stored per institution and synced by the app.
-- 2. audit_log: append-only. UPDATE / DELETE / TRUNCATE are blocked by triggers
--    for every role, and each row carries a SHA-256 hash chained to the previous
--    row of the same institution, so tampering is detectable (audit_verify()).
--    Most entries are written by database triggers on the underlying tables —
--    the browser cannot skip them.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;


-- ── 1. Workspace key-value store ─────────────────────────────────────────────
create table if not exists public.workspace_kv (
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  key             text not null check (key ~ '^[A-Za-z0-9_:.-]{1,120}$'),
  value           text not null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),
  primary key (institution_id, key)
);
create index if not exists workspace_kv_updated_idx on public.workspace_kv (institution_id, updated_at);
alter table public.workspace_kv enable row level security;   -- no policies: functions only

create or replace function public.kv_pull(p_since timestamptz default null)
returns table (key text, value text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select key, value, updated_at from workspace_kv
  where institution_id = my_institution()
    and (p_since is null or updated_at > p_since)
  order by updated_at
$$;

create or replace function public.kv_put(p_key text, p_value text)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); v_at timestamptz := clock_timestamp();
begin
  if me is null then raise exception 'Sign in and join an institution to sync workspace data'; end if;
  if length(p_value) > 2000000 then raise exception 'Value too large'; end if;
  insert into workspace_kv (institution_id, key, value, updated_at, updated_by)
  values (me, p_key, p_value, v_at, auth.uid())
  on conflict (institution_id, key) do update
    set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    where workspace_kv.value is distinct from excluded.value;
  return v_at;
end $$;

create or replace function public.kv_delete(p_key text)
returns void
language sql security definer set search_path = public as $$
  delete from workspace_kv where institution_id = my_institution() and key = p_key
$$;


-- ── 2. Audit log (append-only, hash-chained) ─────────────────────────────────
create table if not exists public.audit_log (
  id              bigint generated always as identity primary key,
  institution_id  uuid not null references public.institutions(id),
  at              timestamptz not null default now(),
  actor_id        uuid,
  actor_email     text not null default '',
  action          text not null,
  entity          text not null default '',
  entity_id       text not null default '',
  detail          jsonb not null default '{}'::jsonb,
  prev_hash       text not null default '',
  hash            text not null default ''
);
create index if not exists audit_log_inst_idx   on public.audit_log (institution_id, id desc);
create index if not exists audit_log_entity_idx on public.audit_log (institution_id, entity_id, id desc);
alter table public.audit_log enable row level security;      -- no policies: functions only

-- The hash covers every field; timestamps are rendered in UTC so verification
-- gives the same result in any session time zone.
create or replace function public.audit_hash(p_prev text, p_inst uuid, p_at timestamptz, p_actor uuid,
                                             p_action text, p_entity text, p_entity_id text, p_detail jsonb)
returns text
language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(
    coalesce(p_prev, '') || '|' || p_inst::text || '|' ||
    to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
    coalesce(p_actor::text, '') || '|' || p_action || '|' || p_entity || '|' || p_entity_id || '|' || p_detail::text,
    'sha256'), 'hex')
$$;

create or replace function public.audit_chain()
returns trigger
language plpgsql security definer set search_path = public as $$
declare last_hash text;
begin
  -- one writer at a time per institution keeps the chain linear
  perform pg_advisory_xact_lock(hashtext('audit:' || new.institution_id::text));
  select hash into last_hash from audit_log where institution_id = new.institution_id order by id desc limit 1;
  new.at        := clock_timestamp();
  new.prev_hash := coalesce(last_hash, '');
  new.hash      := audit_hash(new.prev_hash, new.institution_id, new.at, new.actor_id, new.action, new.entity, new.entity_id, new.detail);
  return new;
end $$;

create or replace function public.audit_immutable()
returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

drop trigger if exists audit_chain on public.audit_log;
create trigger audit_chain before insert on public.audit_log
  for each row execute function public.audit_chain();
drop trigger if exists audit_no_change on public.audit_log;
create trigger audit_no_change before update or delete on public.audit_log
  for each row execute function public.audit_immutable();
drop trigger if exists audit_no_truncate on public.audit_log;
create trigger audit_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_immutable();

-- Internal writer used by the triggers below
create or replace function public.audit_add(p_inst uuid, p_action text, p_entity text, p_entity_id text, p_detail jsonb)
returns void
language sql security definer set search_path = public as $$
  insert into audit_log (institution_id, actor_id, actor_email, action, entity, entity_id, detail)
  select p_inst, auth.uid(), lower(coalesce(auth.jwt()->>'email', '')), p_action, coalesce(p_entity, ''), coalesce(p_entity_id, ''), coalesce(p_detail, '{}'::jsonb)
  where p_inst is not null
$$;

-- From the app: events the database can't see (case viewed, export, …)
create or replace function public.audit_write(p_action text, p_entity text, p_entity_id text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_institution() is null then return; end if;
  if p_action !~ '^[a-z_]{2,30}\.[a-z_]{2,40}$' then raise exception 'Invalid audit action'; end if;
  if length(coalesce(p_detail, '{}'::jsonb)::text) > 4000 then raise exception 'Audit detail too large'; end if;
  perform audit_add(my_institution(), p_action, p_entity, p_entity_id, p_detail);
end $$;

create or replace function public.audit_list(p_entity_id text default null, p_limit int default 200)
returns table (id bigint, at timestamptz, actor_email text, action text, entity text, entity_id text, detail jsonb)
language sql stable security definer set search_path = public as $$
  select id, at, actor_email, action, entity, entity_id, detail from audit_log
  where institution_id = my_institution()
    and (p_entity_id is null or entity_id = p_entity_id)
  order by id desc
  limit least(greatest(coalesce(p_limit, 200), 1), 2000)
$$;

-- Recompute the chain for the caller's institution
create or replace function public.audit_verify()
returns table (ok boolean, checked bigint, first_bad_id bigint)
language plpgsql stable security definer set search_path = public as $$
declare r audit_log; prev text := ''; n bigint := 0;
begin
  if my_institution() is null then raise exception 'Sign in first'; end if;
  for r in select * from audit_log where institution_id = my_institution() order by id loop
    n := n + 1;
    if r.prev_hash <> prev
       or r.hash <> audit_hash(r.prev_hash, r.institution_id, r.at, r.actor_id, r.action, r.entity, r.entity_id, r.detail) then
      return query select false, n, r.id; return;
    end if;
    prev := r.hash;
  end loop;
  return query select true, n, null::bigint;
end $$;


-- ── 3. Events recorded by the database ───────────────────────────────────────
-- Cases: created, status changed, edited (sync re-pushes unchanged data; that is not logged)
create or replace function public.audit_cases()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform audit_add(new.institution_id, 'case.created', 'case', new.id,
      jsonb_build_object('status', new.data->>'status', 'merchant', new.data->>'merchant', 'amount', new.data->>'amount'));
  elsif new.data is distinct from old.data then
    if (new.data->>'status') is distinct from (old.data->>'status') then
      perform audit_add(new.institution_id, 'case.status_changed', 'case', new.id,
        jsonb_build_object('from', old.data->>'status', 'to', new.data->>'status'));
    end if;
    if (new.data->>'assignedTo') is distinct from (old.data->>'assignedTo') then
      perform audit_add(new.institution_id, 'case.assigned', 'case', new.id,
        jsonb_build_object('from', old.data->>'assignedTo', 'to', new.data->>'assignedTo'));
    end if;
    if jsonb_array_length(coalesce(new.data->'docs', '[]'::jsonb)) > jsonb_array_length(coalesce(old.data->'docs', '[]'::jsonb)) then
      perform audit_add(new.institution_id, 'evidence.uploaded', 'case', new.id,
        jsonb_build_object('name', new.data->'docs'->-1->>'name'));
    end if;
    if (new.data - 'updatedAt' - 'history' - 'status' - 'assignedTo' - 'docs')
       is distinct from (old.data - 'updatedAt' - 'history' - 'status' - 'assignedTo' - 'docs') then
      perform audit_add(new.institution_id, 'case.edited', 'case', new.id, '{}'::jsonb);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists audit_cases on public.cov_cases;
create trigger audit_cases after insert or update on public.cov_cases
  for each row when (new.institution_id is not null) execute function public.audit_cases();

-- Team
create or replace function public.audit_memberships()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform audit_add(new.institution_id, 'member.joined', 'member', new.email, jsonb_build_object('role', new.role));
  elsif tg_op = 'DELETE' then
    perform audit_add(old.institution_id, 'member.removed', 'member', old.email, jsonb_build_object('role', old.role));
    return old;
  elsif new.role is distinct from old.role then
    perform audit_add(new.institution_id, 'member.role_changed', 'member', new.email, jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  return new;
end $$;
drop trigger if exists audit_memberships on public.memberships;
create trigger audit_memberships after insert or update or delete on public.memberships
  for each row execute function public.audit_memberships();

create or replace function public.audit_invites()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform audit_add(new.institution_id, 'invite.created', 'invite', new.email, jsonb_build_object('role', new.role));
  elsif tg_op = 'DELETE' then
    if old.accepted_by is null then
      perform audit_add(old.institution_id, 'invite.revoked', 'invite', old.email, '{}'::jsonb);
    end if;
    return old;
  elsif new.accepted_by is not null and old.accepted_by is null then
    perform audit_add(new.institution_id, 'invite.accepted', 'invite', new.email, '{}'::jsonb);
  end if;
  return new;
end $$;
drop trigger if exists audit_invites on public.invites;
create trigger audit_invites after insert or update or delete on public.invites
  for each row execute function public.audit_invites();

-- Duo (logged in each participating institution's own trail)
create or replace function public.audit_duo()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform audit_add(new.institution_a_id, 'duo.created', 'duo', new.id, jsonb_build_object('case', new.claim->>'caseId'));
  else
    if new.institution_b_id is not null and old.institution_b_id is null then
      perform audit_add(new.institution_a_id, 'duo.joined', 'duo', new.id, jsonb_build_object('by', new.institution_b));
      perform audit_add(new.institution_b_id, 'duo.joined', 'duo', new.id, jsonb_build_object('with', new.institution_a));
    end if;
    if new.status is distinct from old.status then
      perform audit_add(new.institution_a_id, 'duo.status_changed', 'duo', new.id, jsonb_build_object('from', old.status, 'to', new.status));
      perform audit_add(new.institution_b_id, 'duo.status_changed', 'duo', new.id, jsonb_build_object('from', old.status, 'to', new.status));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists audit_duo on public.duo_sessions;
create trigger audit_duo after insert or update on public.duo_sessions
  for each row execute function public.audit_duo();

create or replace function public.audit_case_links()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform audit_add(new.sender_institution_id, 'case_link.created', 'case_link', coalesce(new.payload->>'case_ref', ''),
    jsonb_build_object('type', new.case_type));
  return new;
end $$;
drop trigger if exists audit_case_links on public.duo_case_links;
create trigger audit_case_links after insert on public.duo_case_links
  for each row execute function public.audit_case_links();

-- Workspace data: which item changed; for Settings, exactly which fields and their old/new values
create or replace function public.audit_kv()
returns trigger
language plpgsql security definer set search_path = public as $$
declare diff jsonb := '{}'::jsonb; o jsonb; n jsonb; k text;
begin
  if new.key = 'cov_settings' then
    begin
      o := case when tg_op = 'UPDATE' then old.value::jsonb else '{}'::jsonb end;
      n := new.value::jsonb;
      for k in select jsonb_object_keys(o || n) loop
        if (o->k) is distinct from (n->k) then diff := diff || jsonb_build_object(k, jsonb_build_object('from', o->k, 'to', n->k)); end if;
      end loop;
    exception when others then diff := '{}'::jsonb;
    end;
    if diff <> '{}'::jsonb then
      perform audit_add(new.institution_id, 'settings.changed', 'settings', 'cov_settings', diff);
    end if;
  elsif tg_op = 'INSERT' or new.value is distinct from old.value then
    perform audit_add(new.institution_id, 'workspace.updated', 'workspace', new.key, '{}'::jsonb);
  end if;
  return new;
end $$;
drop trigger if exists audit_kv on public.workspace_kv;
create trigger audit_kv after insert or update on public.workspace_kv
  for each row execute function public.audit_kv();


-- ── 4. Who may call what ─────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'kv_pull(timestamptz)','kv_put(text,text)','kv_delete(text)',
    'audit_write(text,text,text,jsonb)','audit_list(text,integer)','audit_verify()']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- internal only
  foreach f in array array['audit_add(uuid,text,text,text,jsonb)','audit_hash(text,uuid,timestamptz,uuid,text,text,text,jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;


-- =============================================================================
-- VERIFY — both tables protected, triggers in place
-- =============================================================================
select tablename, rowsecurity as rls_enabled from pg_tables
where schemaname = 'public' and tablename in ('workspace_kv', 'audit_log')
union all
select 'trigger:' || tgname, true from pg_trigger
where tgname in ('audit_chain','audit_no_change','audit_no_truncate','audit_cases','audit_memberships','audit_invites','audit_duo','audit_case_links','audit_kv')
order by 1;
