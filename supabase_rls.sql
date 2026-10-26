-- =============================================================================
-- COVALENCE — ROW-LEVEL SECURITY (v2)
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run. Safe to re-run.
-- =============================================================================
-- Covalence has no Supabase Auth logins, so every browser talks to the database
-- as the public `anon` role. v1 of this script granted reads to `authenticated`
-- only, which would have broken Duo, case links and the shared case pool.
--
-- v2 model:
--   • Every table has RLS on and NO anon policies → the public key cannot read,
--     list, update or delete any table directly.
--   • The app calls a small set of SECURITY DEFINER functions instead. Each one
--     only does what the UI needs (fetch one Duo session by code, fetch one case
--     link by token, read cases for your own institution's workspace, …).
--
-- Run this BEFORE deploying the matching app build. The app falls back to the
-- old direct-table calls if a function is missing, so order is forgiving.
-- =============================================================================


-- ── 1. Workspace column: scopes the shared case pool to one institution ──────
alter table if exists public.cov_cases          add column if not exists workspace text not null default '';
alter table if exists public.cov_trio_incidents add column if not exists workspace text not null default '';
create index if not exists cov_cases_workspace_idx on public.cov_cases (workspace, updated_at desc);


-- ── 2. RLS on, all existing policies dropped ─────────────────────────────────
do $$
declare t text; p record;
begin
  foreach t in array array['access_log','duo_sessions','cov_cases','cov_agents','cov_trio_incidents',
                           'duo_case_links','case_link_access_log','case_link_responses']
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;

-- Write-only logs: visitors can add a row, nobody can read them from the browser.
-- (You can still read them in the Supabase dashboard, which bypasses RLS.)
create policy access_log_insert on public.access_log
  for insert to anon with check (true);
create policy case_link_access_insert on public.case_link_access_log
  for insert to anon with check (true);
create policy case_link_responses_insert on public.case_link_responses
  for insert to anon with check (true);


-- ── 3. Duo sessions — only by six-character code ─────────────────────────────
create or replace function public.duo_get(p_id text)
returns setof public.duo_sessions
language sql stable security definer set search_path = public as $$
  select * from duo_sessions where id::text = upper(p_id) limit 1
$$;

-- jsonb_populate_record maps JSON onto the table's own column types, so these
-- work whether notes/claim columns are text or jsonb. Unlisted columns
-- (created_at, updated_at) keep their table defaults.
create or replace function public.duo_create(p jsonb)
returns setof public.duo_sessions
language sql security definer set search_path = public as $$
  insert into duo_sessions (id, institution_a, institution_b, claim, notes_a, notes_b, status)
  select r.id, r.institution_a, r.institution_b, r.claim, r.notes_a, r.notes_b, r.status
  from jsonb_populate_record(null::duo_sessions, p) r
  returning *
$$;

-- Only the fields the UI edits: joining (institution_b), the two note threads, status.
-- Passing the current row as the base keeps any field not in `p` unchanged.
create or replace function public.duo_update(p_id text, p jsonb)
returns setof public.duo_sessions
language sql security definer set search_path = public as $$
  update duo_sessions d set
    institution_b = r.institution_b,
    notes_a       = r.notes_a,
    notes_b       = r.notes_b,
    status        = r.status,
    updated_at    = now()
  from duo_sessions cur
  cross join lateral jsonb_populate_record(cur, p - 'id' - 'claim' - 'institution_a' - 'created_at') r
  where cur.id = d.id and d.id::text = upper(p_id)
  returning d.*
$$;

-- "Resume sessions": exact institution name (case-insensitive), not a substring
-- search, and only the fields the resume list shows.
create or replace function public.duo_find(p_institution text)
returns table (id text, institution_a text, institution_b text, status text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id::text, institution_a, institution_b, status, created_at::timestamptz
  from duo_sessions
  where length(trim(p_institution)) >= 3
    and (lower(institution_a) = lower(trim(p_institution)) or lower(institution_b) = lower(trim(p_institution)))
  order by created_at desc
  limit 10
$$;


-- ── 4. Secure case links — only by token ─────────────────────────────────────
create or replace function public.case_link_get(p_token text)
returns setof public.duo_case_links
language sql stable security definer set search_path = public as $$
  select * from duo_case_links where token::text = p_token limit 1
$$;

create or replace function public.case_link_create(p jsonb)
returns setof public.duo_case_links
language sql security definer set search_path = public as $$
  insert into duo_case_links (case_type, sender_institution, payload)
  select r.case_type, r.sender_institution, r.payload
  from jsonb_populate_record(null::duo_case_links, p) r
  returning *
$$;

create or replace function public.case_link_activity(p_token text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'responses', coalesce((select jsonb_agg(r order by r.responded_at desc) from case_link_responses r where r.token::text = p_token), '[]'::jsonb),
    'access',    coalesce((select jsonb_agg(a order by a.accessed_at desc) from case_link_access_log a where a.token::text = p_token), '[]'::jsonb)
  )
$$;


-- ── 5. Shared case pool + Trio incidents — scoped to a workspace ─────────────
-- Workspace = the institution name entered at sign-in, lower-cased.
-- NOTE: this keeps strangers out of each other's cases, but anyone who types
-- the same institution name joins that workspace. Real per-user access needs
-- Supabase Auth — the next step once a design partner is onboard.
create or replace function public.cov_pull_cases(p_workspace text)
returns table (data jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select data::jsonb, updated_at::timestamptz from cov_cases
  where workspace = lower(trim(p_workspace))
  order by updated_at desc limit 500
$$;

create or replace function public.cov_push_cases(p_workspace text, p_rows jsonb)
returns void
language sql security definer set search_path = public as $$
  insert into cov_cases (id, data, assigned_to, updated_at, workspace)
  select r->>'id', r->'data', r->>'assigned_to', coalesce((r->>'updated_at')::timestamptz, now()), lower(trim(p_workspace))
  from jsonb_array_elements(p_rows) r
  on conflict (id) do update set
    data = excluded.data, assigned_to = excluded.assigned_to, updated_at = excluded.updated_at
  where cov_cases.workspace = excluded.workspace or cov_cases.workspace = ''
$$;

create or replace function public.cov_pull_trio(p_workspace text)
returns table (data jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select data::jsonb, updated_at::timestamptz from cov_trio_incidents
  where workspace = lower(trim(p_workspace))
  order by updated_at desc limit 100
$$;

create or replace function public.cov_push_trio(p_workspace text, p_rows jsonb)
returns void
language sql security definer set search_path = public as $$
  insert into cov_trio_incidents (id, data, updated_at, workspace)
  select r->>'id', r->'data', coalesce((r->>'updated_at')::timestamptz, now()), lower(trim(p_workspace))
  from jsonb_array_elements(p_rows) r
  on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at
  where cov_trio_incidents.workspace = excluded.workspace or cov_trio_incidents.workspace = ''
$$;


-- ── 6. Agents — list only your own institution's team ────────────────────────
create or replace function public.cov_upsert_agent(p_email text, p_name text, p_institution text)
returns void
language sql security definer set search_path = public as $$
  insert into cov_agents (email, name, institution, last_login)
  values (p_email, p_name, coalesce(p_institution, ''), now())
  on conflict (email) do update set name = excluded.name, institution = excluded.institution, last_login = now()
$$;

create or replace function public.cov_list_agents(p_institution text)
returns table (email text, name text, institution text)
language sql stable security definer set search_path = public as $$
  select email, name, institution from cov_agents
  where length(trim(p_institution)) > 0 and lower(institution) = lower(trim(p_institution))
  order by name limit 100
$$;


-- ── 7. Only these functions are callable by the public key ───────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'duo_get(text)','duo_create(jsonb)','duo_update(text,jsonb)','duo_find(text)',
    'case_link_get(text)','case_link_create(jsonb)','case_link_activity(text)',
    'cov_pull_cases(text)','cov_push_cases(text,jsonb)','cov_pull_trio(text)','cov_push_trio(text,jsonb)',
    'cov_upsert_agent(text,text,text)','cov_list_agents(text)']
  loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;


-- =============================================================================
-- VERIFY — every row should say rls_enabled = true
-- =============================================================================
select tablename, rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
  and tablename in ('access_log','duo_sessions','cov_cases','cov_agents','cov_trio_incidents',
                    'duo_case_links','case_link_access_log','case_link_responses')
order by tablename;
