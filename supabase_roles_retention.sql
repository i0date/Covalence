-- =============================================================================
-- COVALENCE — ROLES, LEGAL HOLDS AND DATA RETENTION
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run. Safe to re-run.
-- Run AFTER supabase_auth.sql and supabase_workspace_audit.sql.
-- =============================================================================
-- Roles (enforced here, in the database — the browser cannot bypass them):
--   admin     everything: team, roles, settings, retention policy, purge
--   reviewer  work cases + change settings, place/lift legal holds
--   analyst   work cases (the default for new members; replaces "member")
--   auditor   read-only: sees cases, audit log and exports; cannot change anything
-- Retention: closed cases older than the institution's retention period can be
-- purged by an admin (with their evidence files, via /api/retention); cases on
-- legal hold are never purged. Purged case ids are remembered so a browser that
-- still has an old copy can't re-upload it. Every step is in the audit log.
-- =============================================================================


-- ── 1. Four roles ────────────────────────────────────────────────────────────
alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.invites     drop constraint if exists invites_role_check;
update public.memberships set role = 'analyst' where role = 'member';
update public.invites     set role = 'analyst' where role = 'member';
alter table public.memberships alter column role set default 'analyst';
alter table public.invites     alter column role set default 'analyst';
alter table public.memberships add constraint memberships_role_check check (role in ('admin','reviewer','analyst','auditor'));
alter table public.invites     add constraint invites_role_check     check (role in ('admin','reviewer','analyst','auditor'));

create or replace function public.my_role()
returns text
language sql stable security definer set search_path = public as $$
  select role from memberships where user_id = auth.uid()
$$;
-- Can change case data, Duo, case links, evidence, workspace data
create or replace function public.can_write()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin','reviewer','analyst'), false)
$$;
-- Can change institution settings and legal holds
create or replace function public.can_configure()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin','reviewer'), false)
$$;
create or replace function public.need_write()
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if my_institution() is null then raise exception 'Sign in and join an institution first'; end if;
  if not can_write() then raise exception 'Your role (%) is read-only', coalesce(my_role(), 'none'); end if;
end $$;


-- ── 2. Team: invite any role, change roles ───────────────────────────────────
create or replace function public.create_invite(p_email text, p_role text default 'analyst')
returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not is_institution_admin() then raise exception 'Only an institution admin can invite'; end if;
  if p_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then raise exception 'Enter a valid email address'; end if;
  if coalesce(p_role, 'analyst') not in ('admin','reviewer','analyst','auditor') then raise exception 'Unknown role'; end if;
  insert into invites (institution_id, email, role, created_by)
  values (my_institution(), lower(trim(p_email)), coalesce(p_role, 'analyst'), auth.uid())
  returning code into v_code;
  return v_code;
end $$;

create or replace function public.set_member_role(p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_institution_admin() then raise exception 'Only an institution admin can change roles'; end if;
  if p_role not in ('admin','reviewer','analyst','auditor') then raise exception 'Unknown role'; end if;
  if p_user_id = auth.uid() and p_role <> 'admin'
     and (select count(*) from memberships where institution_id = my_institution() and role = 'admin') <= 1 then
    raise exception 'You are the only admin — make someone else admin first';
  end if;
  update memberships set role = p_role where user_id = p_user_id and institution_id = my_institution();
end $$;


-- ── 3. Writes now check the role ─────────────────────────────────────────────
create table if not exists public.purged_cases (
  institution_id uuid not null references public.institutions(id) on delete cascade,
  case_id        text not null,
  purged_at      timestamptz not null default now(),
  purged_by      uuid references auth.users(id),
  primary key (institution_id, case_id)
);
alter table public.purged_cases enable row level security;

create or replace function public.cov_push_cases(p_workspace text, p_rows jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution();
begin
  perform need_write();
  insert into cov_cases (id, data, assigned_to, updated_at, institution_id)
  select r->>'id', r->'data', r->>'assigned_to', coalesce((r->>'updated_at')::timestamptz, now()), me
  from jsonb_array_elements(p_rows) r
  where not exists (select 1 from purged_cases p where p.institution_id = me and p.case_id = r->>'id')  -- purged stays purged
  on conflict (id) do update set
    data = excluded.data, assigned_to = excluded.assigned_to, updated_at = excluded.updated_at
  where cov_cases.institution_id = excluded.institution_id;
end $$;

create or replace function public.cov_push_trio(p_workspace text, p_rows jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution();
begin
  perform need_write();
  insert into cov_trio_incidents (id, data, updated_at, institution_id)
  select r->>'id', r->'data', coalesce((r->>'updated_at')::timestamptz, now()), me
  from jsonb_array_elements(p_rows) r
  on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at
  where cov_trio_incidents.institution_id = excluded.institution_id;
end $$;

-- Institution settings need admin/reviewer; other workspace data needs write access
create or replace function public.kv_put(p_key text, p_value text)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); v_at timestamptz := clock_timestamp();
begin
  perform need_write();
  if p_key in ('cov_settings', 'cov_autobatch_3pm') and not can_configure() then
    raise exception 'Only admins and reviewers can change institution settings';
  end if;
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
language plpgsql security definer set search_path = public as $$
begin
  perform need_write();
  if p_key in ('cov_settings', 'cov_autobatch_3pm') and not can_configure() then
    raise exception 'Only admins and reviewers can change institution settings';
  end if;
  delete from workspace_kv where institution_id = my_institution() and key = p_key;
end $$;

create or replace function public.duo_create(p jsonb)
returns setof public.duo_sessions
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution();
begin
  perform need_write();
  return query
  with ins as (
    insert into duo_sessions (id, institution_a, institution_b, claim, notes_a, notes_b, status, institution_a_id)
    select r.id, (select name from institutions where id = me), '', r.claim, r.notes_a, r.notes_b, r.status, me
    from jsonb_populate_record(null::duo_sessions, p) r
    returning *)
  select * from ins;
end $$;

create or replace function public.duo_update(p_id text, p jsonb)
returns setof public.duo_sessions
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); cur duo_sessions; r duo_sessions; legacy boolean;
begin
  perform need_write();
  select * into cur from duo_sessions where id::text = upper(p_id);
  if not found then return; end if;
  legacy := cur.institution_a_id is null;
  if p ? 'institution_b' and cur.institution_b_id is null and cur.institution_a_id is distinct from me then
    update duo_sessions set institution_b = (select name from institutions where id = me),
                            institution_b_id = me, updated_at = now()
    where id = cur.id returning * into cur;
  end if;
  if not legacy and me is distinct from cur.institution_a_id and me is distinct from cur.institution_b_id then
    raise exception 'Your institution is not part of this Duo session';
  end if;
  r := jsonb_populate_record(cur, p - 'id' - 'claim' - 'institution_a' - 'institution_b'
                                    - 'institution_a_id' - 'institution_b_id' - 'created_at');
  return query
  with upd as (
    update duo_sessions set
      notes_a    = case when legacy or me = cur.institution_a_id then r.notes_a else cur.notes_a end,
      notes_b    = case when legacy or me = cur.institution_b_id then r.notes_b else cur.notes_b end,
      status     = r.status,
      updated_at = now()
    where id = cur.id
    returning *)
  select * from upd;
end $$;

create or replace function public.case_link_create(p jsonb)
returns setof public.duo_case_links
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution();
begin
  perform need_write();
  return query
  with ins as (
    insert into duo_case_links (case_type, sender_institution, payload, sender_institution_id)
    select r.case_type, (select name from institutions where id = me), r.payload, me
    from jsonb_populate_record(null::duo_case_links, p) r
    returning *)
  select * from ins;
end $$;

-- Evidence uploads: write roles only
drop policy if exists cov_evidence_auth_insert on storage.objects;
create policy cov_evidence_auth_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cov-evidence' and public.can_write());


-- ── 4. Legal holds ───────────────────────────────────────────────────────────
create table if not exists public.legal_holds (
  institution_id uuid not null references public.institutions(id) on delete cascade,
  case_id        text not null,
  reason         text not null default '',
  set_by         uuid references auth.users(id),
  set_at         timestamptz not null default now(),
  primary key (institution_id, case_id)
);
alter table public.legal_holds enable row level security;

create or replace function public.legal_hold_set(p_case_id text, p_on boolean, p_reason text default '')
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution();
begin
  if not can_configure() then raise exception 'Only admins and reviewers can place or lift legal holds'; end if;
  if p_on then
    insert into legal_holds (institution_id, case_id, reason, set_by)
    values (me, p_case_id, left(coalesce(p_reason, ''), 500), auth.uid())
    on conflict (institution_id, case_id) do update set reason = excluded.reason, set_by = excluded.set_by, set_at = now();
    perform audit_add(me, 'case.legal_hold_on', 'case', p_case_id, jsonb_build_object('reason', left(coalesce(p_reason, ''), 500)));
  else
    delete from legal_holds where institution_id = me and case_id = p_case_id;
    perform audit_add(me, 'case.legal_hold_off', 'case', p_case_id, '{}'::jsonb);
  end if;
end $$;

create or replace function public.legal_holds_list()
returns table (case_id text, reason text, set_at timestamptz, set_by_email text)
language sql stable security definer set search_path = public as $$
  select h.case_id, h.reason, h.set_at, coalesce(m.email, '')
  from legal_holds h left join memberships m on m.user_id = h.set_by
  where h.institution_id = my_institution()
  order by h.set_at desc
$$;


-- ── 5. Retention policy and purge ────────────────────────────────────────────
create table if not exists public.retention_policy (
  institution_id    uuid primary key references public.institutions(id) on delete cascade,
  closed_case_days  int not null default 1825 check (closed_case_days between 365 and 36500),  -- default 5 years
  updated_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now()
);
alter table public.retention_policy enable row level security;

create or replace function public.retention_set(p_days int)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); old_days int;
begin
  if not is_institution_admin() then raise exception 'Only an institution admin can change retention'; end if;
  if p_days < 365 or p_days > 36500 then raise exception 'Retention must be between 1 and 100 years'; end if;
  select closed_case_days into old_days from retention_policy where institution_id = me;
  insert into retention_policy (institution_id, closed_case_days, updated_by, updated_at)
  values (me, p_days, auth.uid(), now())
  on conflict (institution_id) do update set closed_case_days = excluded.closed_case_days, updated_by = excluded.updated_by, updated_at = now();
  perform audit_add(me, 'retention.policy_changed', 'retention', '', jsonb_build_object('from_days', coalesce(old_days, 1825), 'to_days', p_days));
end $$;

-- A bad date string on one case must not break retention for everyone
create or replace function public.try_ts(p text)
returns timestamptz
language plpgsql stable as $$
begin
  return nullif(p, '')::timestamptz;
exception when others then
  return null;
end $$;

-- Closed cases past the retention period, not on legal hold. A case counts as
-- closed when its status is won / lost / withdrawn / resolved / closed; its age
-- runs from resolvedDate, else from the last update.
create or replace function public.retention_candidates()
returns table (case_id text, status text, closed_on timestamptz)
language sql stable security definer set search_path = public as $$
  with pol as (select coalesce((select closed_case_days from retention_policy where institution_id = my_institution()), 1825) as days)
  select c.id, c.data->>'status',
         coalesce(try_ts(c.data->>'resolvedDate'), c.updated_at)
  from cov_cases c, pol
  where c.institution_id = my_institution()
    and c.data->>'status' in ('won','lost','withdrawn','resolved','closed')
    and coalesce(try_ts(c.data->>'resolvedDate'), c.updated_at) < now() - make_interval(days => pol.days)
    and not exists (select 1 from legal_holds h where h.institution_id = c.institution_id and h.case_id = c.id)
  order by 3
$$;

create or replace function public.retention_get()
returns table (closed_case_days int, updated_at timestamptz, eligible int, on_hold int, purged_total int)
language sql stable security definer set search_path = public as $$
  select coalesce(p.closed_case_days, 1825), p.updated_at,
         (select count(*)::int from retention_candidates()),
         (select count(*)::int from legal_holds where institution_id = my_institution()),
         (select count(*)::int from purged_cases where institution_id = my_institution())
  from (select 1) one left join retention_policy p on p.institution_id = my_institution()
  where my_institution() is not null
$$;

-- Admin-only. /api/retention deletes the evidence files first, then calls this.
create or replace function public.retention_purge(p_case_ids text[])
returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); n int := 0; cid text;
begin
  if not is_institution_admin() then raise exception 'Only an institution admin can purge'; end if;
  for cid in select c.case_id from retention_candidates() c where c.case_id = any(p_case_ids) loop
    delete from cov_cases where id = cid and institution_id = me;
    insert into purged_cases (institution_id, case_id, purged_by) values (me, cid, auth.uid()) on conflict do nothing;
    perform audit_add(me, 'case.purged', 'case', cid, jsonb_build_object('reason', 'retention'));
    n := n + 1;
  end loop;
  if n > 0 then perform audit_add(me, 'retention.purged', 'retention', '', jsonb_build_object('cases', n)); end if;
  return n;
end $$;

-- Browsers remove local copies of purged cases
create or replace function public.cov_purged_ids()
returns table (case_id text)
language sql stable security definer set search_path = public as $$
  select case_id from purged_cases where institution_id = my_institution()
$$;


-- ── 6. Who may call what ─────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'my_role()','can_write()','can_configure()','set_member_role(uuid,text)','create_invite(text,text)',
    'legal_hold_set(text,boolean,text)','legal_holds_list()',
    'retention_get()','retention_set(integer)','retention_candidates()','retention_purge(text[])','cov_purged_ids()',
    'cov_push_cases(text,jsonb)','cov_push_trio(text,jsonb)','kv_put(text,text)','kv_delete(text)',
    'duo_create(jsonb)','duo_update(text,jsonb)','case_link_create(jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public.need_write() from public, anon, authenticated';
end $$;


-- =============================================================================
-- VERIFY
-- =============================================================================
select 'roles in use' as item, coalesce(string_agg(distinct role, ', '), '(no members yet)') as value from public.memberships
union all select 'tables', string_agg(tablename, ', ' order by tablename) from pg_tables
  where schemaname = 'public' and tablename in ('legal_holds','retention_policy','purged_cases') and rowsecurity;
