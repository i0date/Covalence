-- =============================================================================
-- COVALENCE — SIGNED-IN USERS AND INSTITUTIONS (v3 security model)
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run. Safe to re-run.
-- Run AFTER supabase_rls.sql and supabase_storage.sql.
-- =============================================================================
-- Before: shared data was scoped by the institution name typed at the welcome
-- screen, so anyone typing "First National" joined First National's workspace.
-- After:
--   • Shared features need a real Supabase Auth sign-in (email code).
--   • A user belongs to exactly one institution. The first person creates it and
--     becomes admin; everyone else joins only through an admin's invite, which
--     is bound to their email address.
--   • Cases, Trio incidents, the team list, Duo sessions and case-link activity
--     are scoped to the caller's institution inside the database — the browser
--     cannot ask for another institution's data.
--   • Visitors who aren't signed in keep the local demo; they can still open a
--     case link sent to them (counterparty view) and log their visit.
-- =============================================================================


-- ── 1. Institutions, memberships, invites ────────────────────────────────────
create table if not exists public.institutions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 2 and 120),
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now()
);

create table if not exists public.memberships (
  user_id         uuid primary key references auth.users(id) on delete cascade,   -- one institution per user
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  role            text not null default 'member' check (role in ('admin','member')),
  display_name    text not null default '',
  email           text not null default '',
  created_at      timestamptz not null default now()
);
create index if not exists memberships_institution_idx on public.memberships (institution_id);

create table if not exists public.invites (
  code            text primary key default replace(gen_random_uuid()::text, '-', ''),
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  email           text not null,
  role            text not null default 'member' check (role in ('admin','member')),
  created_by      uuid not null references auth.users(id),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '14 days',
  accepted_by     uuid references auth.users(id),
  accepted_at     timestamptz
);

-- Closed tables: reachable only through the functions below
alter table public.institutions enable row level security;
alter table public.memberships  enable row level security;
alter table public.invites      enable row level security;


-- ── 2. Institution columns on shared data ────────────────────────────────────
alter table public.cov_cases          add column if not exists institution_id uuid references public.institutions(id);
alter table public.cov_trio_incidents add column if not exists institution_id uuid references public.institutions(id);
alter table public.duo_sessions       add column if not exists institution_a_id uuid references public.institutions(id);
alter table public.duo_sessions       add column if not exists institution_b_id uuid references public.institutions(id);
alter table public.duo_case_links     add column if not exists sender_institution_id uuid references public.institutions(id);
create index if not exists cov_cases_institution_idx on public.cov_cases (institution_id, updated_at desc);


-- ── 3. Who am I ──────────────────────────────────────────────────────────────
create or replace function public.my_institution()
returns uuid
language sql stable security definer set search_path = public as $$
  select institution_id from memberships where user_id = auth.uid()
$$;

create or replace function public.my_membership()
returns table (institution_id uuid, institution_name text, role text, display_name text, email text)
language sql stable security definer set search_path = public as $$
  select m.institution_id, i.name, m.role, m.display_name, m.email
  from memberships m join institutions i on i.id = m.institution_id
  where m.user_id = auth.uid()
$$;

create or replace function public.is_institution_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where user_id = auth.uid() and role = 'admin')
$$;


-- ── 4. Onboarding: create an institution, or accept an invite ────────────────
create or replace function public.create_institution(p_name text, p_display_name text)
returns table (institution_id uuid, institution_name text, role text, display_name text, email text)
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from memberships where user_id = auth.uid()) then
    raise exception 'You already belong to an institution';
  end if;
  insert into institutions (name, created_by) values (trim(p_name), auth.uid()) returning id into v_id;
  insert into memberships (user_id, institution_id, role, display_name, email)
  values (auth.uid(), v_id, 'admin', trim(coalesce(p_display_name, '')), lower(coalesce(auth.jwt()->>'email', '')));
  return query select * from my_membership();
end $$;

create or replace function public.accept_invite(p_code text, p_display_name text)
returns table (institution_id uuid, institution_name text, role text, display_name text, email text)
language plpgsql security definer set search_path = public as $$
declare inv invites;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into inv from invites
  where code = trim(p_code) and accepted_by is null and expires_at > now();
  if not found then raise exception 'Invite not found, already used, or expired'; end if;
  if lower(inv.email) <> lower(coalesce(auth.jwt()->>'email', '')) then
    raise exception 'This invite was sent to a different email address';
  end if;
  if exists (select 1 from memberships where user_id = auth.uid()) then
    raise exception 'You already belong to an institution';
  end if;
  insert into memberships (user_id, institution_id, role, display_name, email)
  values (auth.uid(), inv.institution_id, inv.role, trim(coalesce(p_display_name, '')), lower(inv.email));
  update invites set accepted_by = auth.uid(), accepted_at = now() where code = inv.code;
  return query select * from my_membership();
end $$;


-- ── 5. Team management (admins) ──────────────────────────────────────────────
create or replace function public.create_invite(p_email text, p_role text default 'member')
returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not is_institution_admin() then raise exception 'Only an institution admin can invite'; end if;
  if p_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then raise exception 'Enter a valid email address'; end if;
  insert into invites (institution_id, email, role, created_by)
  values (my_institution(), lower(trim(p_email)), case when p_role = 'admin' then 'admin' else 'member' end, auth.uid())
  returning code into v_code;
  return v_code;
end $$;

create or replace function public.list_team()
returns table (user_id uuid, display_name text, email text, role text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select user_id, display_name, email, role, created_at from memberships
  where institution_id = my_institution()
  order by role, display_name
$$;

create or replace function public.list_invites()
returns table (code text, email text, role text, created_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select code, email, role, created_at, expires_at from invites
  where is_institution_admin() and institution_id = my_institution()
    and accepted_by is null and expires_at > now()
  order by created_at desc
$$;

create or replace function public.revoke_invite(p_code text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_institution_admin() then raise exception 'Only an institution admin can revoke invites'; end if;
  delete from invites where code = p_code and institution_id = my_institution() and accepted_by is null;
end $$;

create or replace function public.remove_member(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_institution_admin() then raise exception 'Only an institution admin can remove members'; end if;
  if p_user_id = auth.uid() then raise exception 'You cannot remove yourself'; end if;
  delete from memberships where user_id = p_user_id and institution_id = my_institution();
end $$;


-- ── 6. Shared case pool + Trio — scoped to the caller's institution ──────────
-- Signatures are unchanged from v2; p_workspace is ignored (kept so older
-- clients don't break). Data is scoped by my_institution(), not by a name.
create or replace function public.cov_pull_cases(p_workspace text)
returns table (data jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select data::jsonb, updated_at::timestamptz from cov_cases
  where institution_id = my_institution()
  order by updated_at desc limit 500
$$;

create or replace function public.cov_push_cases(p_workspace text, p_rows jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution();
begin
  if me is null then raise exception 'Sign in and join an institution to sync cases'; end if;
  insert into cov_cases (id, data, assigned_to, updated_at, institution_id)
  select r->>'id', r->'data', r->>'assigned_to', coalesce((r->>'updated_at')::timestamptz, now()), me
  from jsonb_array_elements(p_rows) r
  on conflict (id) do update set
    data = excluded.data, assigned_to = excluded.assigned_to, updated_at = excluded.updated_at
  where cov_cases.institution_id = excluded.institution_id;
end $$;

create or replace function public.cov_pull_trio(p_workspace text)
returns table (data jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select data::jsonb, updated_at::timestamptz from cov_trio_incidents
  where institution_id = my_institution()
  order by updated_at desc limit 100
$$;

create or replace function public.cov_push_trio(p_workspace text, p_rows jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution();
begin
  if me is null then raise exception 'Sign in and join an institution to sync incidents'; end if;
  insert into cov_trio_incidents (id, data, updated_at, institution_id)
  select r->>'id', r->'data', coalesce((r->>'updated_at')::timestamptz, now()), me
  from jsonb_array_elements(p_rows) r
  on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at
  where cov_trio_incidents.institution_id = excluded.institution_id;
end $$;

-- Team list for assignment dropdowns (same shape the app already reads)
create or replace function public.cov_list_agents(p_institution text)
returns table (email text, name text, institution text)
language sql stable security definer set search_path = public as $$
  select m.email, coalesce(nullif(m.display_name, ''), m.email), i.name
  from memberships m join institutions i on i.id = m.institution_id
  where m.institution_id = my_institution()
  order by 2 limit 200
$$;


-- ── 7. Duo — institution names come from the membership, not the browser ─────
create or replace function public.duo_create(p jsonb)
returns setof public.duo_sessions
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution();
begin
  if me is null then raise exception 'Sign in and join an institution to use Duo'; end if;
  return query
  with ins as (
    insert into duo_sessions (id, institution_a, institution_b, claim, notes_a, notes_b, status, institution_a_id)
    select r.id, (select name from institutions where id = me), '', r.claim, r.notes_a, r.notes_b, r.status, me
    from jsonb_populate_record(null::duo_sessions, p) r
    returning *)
  select * from ins;
end $$;

-- Visible to its two institutions; an unjoined session is visible to any
-- signed-in institution holding the code (so it can join). Sessions created
-- before v3 (no institution ids) stay reachable by code.
create or replace function public.duo_get(p_id text)
returns setof public.duo_sessions
language sql stable security definer set search_path = public as $$
  select * from duo_sessions
  where id::text = upper(p_id) and my_institution() is not null
    and (institution_a_id is null or institution_b_id is null
         or my_institution() in (institution_a_id, institution_b_id))
  limit 1
$$;

create or replace function public.duo_update(p_id text, p jsonb)
returns setof public.duo_sessions
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); cur duo_sessions; r duo_sessions; legacy boolean;
begin
  if me is null then raise exception 'Sign in and join an institution to use Duo'; end if;
  select * into cur from duo_sessions where id::text = upper(p_id);
  if not found then return; end if;
  legacy := cur.institution_a_id is null;

  -- Joining: the second institution claims slot B with its own (server-known) name
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
  -- Each side may only write its own note thread
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

create or replace function public.duo_find(p_institution text)
returns table (id text, institution_a text, institution_b text, status text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id::text, institution_a, institution_b, status, created_at::timestamptz
  from duo_sessions
  where my_institution() is not null and my_institution() in (institution_a_id, institution_b_id)
  order by created_at desc
  limit 20
$$;


-- ── 8. Case links — sender is stamped from the membership ────────────────────
create or replace function public.case_link_create(p jsonb)
returns setof public.duo_case_links
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution();
begin
  if me is null then raise exception 'Sign in and join an institution to send case links'; end if;
  return query
  with ins as (
    insert into duo_case_links (case_type, sender_institution, payload, sender_institution_id)
    select r.case_type, (select name from institutions where id = me), r.payload, me
    from jsonb_populate_record(null::duo_case_links, p) r
    returning *)
  select * from ins;
end $$;

-- Responses and access log: only the sending institution
create or replace function public.case_link_activity(p_token text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when exists (
      select 1 from duo_case_links l
      where l.token::text = p_token and my_institution() is not null
        and (l.sender_institution_id is null or l.sender_institution_id = my_institution()))
    then jsonb_build_object(
      'responses', coalesce((select jsonb_agg(r order by r.responded_at desc) from case_link_responses r where r.token::text = p_token), '[]'::jsonb),
      'access',    coalesce((select jsonb_agg(a order by a.accessed_at desc) from case_link_access_log a where a.token::text = p_token), '[]'::jsonb))
    else jsonb_build_object('responses', '[]'::jsonb, 'access', '[]'::jsonb)
  end
$$;
-- case_link_get stays public: the counterparty opens the link without an account.


-- ── 9. Evidence uploads need a signed-in user ────────────────────────────────
drop policy if exists cov_evidence_anon_insert on storage.objects;
drop policy if exists cov_evidence_auth_insert on storage.objects;
create policy cov_evidence_auth_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cov-evidence');


-- ── 10. Who may call what ────────────────────────────────────────────────────
do $$
declare f text;
begin
  -- Signed-in users only
  foreach f in array array[
    'my_institution()','my_membership()','is_institution_admin()',
    'create_institution(text,text)','accept_invite(text,text)',
    'create_invite(text,text)','list_team()','list_invites()','revoke_invite(text)','remove_member(uuid)',
    'cov_pull_cases(text)','cov_push_cases(text,jsonb)','cov_pull_trio(text)','cov_push_trio(text,jsonb)',
    'cov_list_agents(text)',
    'duo_create(jsonb)','duo_get(text)','duo_update(text,jsonb)','duo_find(text)',
    'case_link_create(jsonb)','case_link_activity(text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- Public: the counterparty's view of a case link
  execute 'revoke all on function public.case_link_get(text) from public';
  execute 'grant execute on function public.case_link_get(text) to anon, authenticated';
  -- Replaced by memberships
  if to_regprocedure('public.cov_upsert_agent(text,text,text)') is not null then
    execute 'revoke all on function public.cov_upsert_agent(text,text,text) from public, anon, authenticated';
  end if;
end $$;


-- =============================================================================
-- VERIFY — expect three rows with rls_enabled = true
-- =============================================================================
select tablename, rowsecurity as rls_enabled from pg_tables
where schemaname = 'public' and tablename in ('institutions','memberships','invites')
order by tablename;
