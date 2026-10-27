-- =============================================================================
-- Covalence — case sync at import volume (step 7: CSV import)
-- =============================================================================
-- Run once in the Supabase SQL editor, after supabase_roles_retention.sql.
-- Safe to re-run.
--
-- 1. cov_pull_cases_page: pulls the institution's cases a page (≤1000 rows) at
--    a time, optionally only those changed since a point in time. The old
--    cov_pull_cases stopped at the 500 most recently updated cases, so a
--    workspace with more than 500 cases never reached everyone's browser.
-- 2. cov_push_cases: stamps rows with the server's clock (now()) rather than
--    the browser's, so "changed since" pulls can't miss rows because of a
--    skewed laptop clock; and refuses more than 1000 rows per call (the app
--    sends 500 at a time). Behaviour is otherwise unchanged: writers only,
--    institution-scoped, purged cases stay purged.
-- =============================================================================

create index if not exists cov_cases_inst_updated_idx on public.cov_cases (institution_id, updated_at, id);

create or replace function public.cov_pull_cases_page(p_since timestamptz default null, p_offset int default 0, p_limit int default 1000)
returns table (data jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.data::jsonb, c.updated_at::timestamptz from cov_cases c
  where c.institution_id = my_institution()
    and (p_since is null or c.updated_at > p_since)
  order by c.updated_at, c.id
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
$$;

create or replace function public.cov_push_cases(p_workspace text, p_rows jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution();
begin
  perform need_write();
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 1000 then raise exception 'Send at most 1000 cases at a time'; end if;
  insert into cov_cases (id, data, assigned_to, updated_at, institution_id)
  select r->>'id', r->'data', r->>'assigned_to', now(), me
  from jsonb_array_elements(p_rows) r
  where not exists (select 1 from purged_cases p where p.institution_id = me and p.case_id = r->>'id')  -- purged stays purged
  on conflict (id) do update set
    data = excluded.data, assigned_to = excluded.assigned_to, updated_at = now()
  where cov_cases.institution_id = excluded.institution_id
    and cov_cases.data is distinct from excluded.data;   -- an unchanged case keeps its timestamp
end $$;

revoke all on function public.cov_pull_cases_page(timestamptz, int, int) from public, anon;
grant execute on function public.cov_pull_cases_page(timestamptz, int, int) to authenticated;
revoke all on function public.cov_push_cases(text, jsonb) from public, anon;
grant execute on function public.cov_push_cases(text, jsonb) to authenticated;

-- Check: both functions exist and only signed-in users can call them
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_can_call,
       has_function_privilege('authenticated', p.oid, 'execute') as signed_in_can_call
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('cov_pull_cases_page', 'cov_push_cases');
