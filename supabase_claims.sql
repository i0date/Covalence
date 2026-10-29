-- =============================================================================
-- Covalence — Claims from the bank's app (api/claims.js → 001 Triage → Claims)
-- =============================================================================
-- Run once in the Supabase SQL editor, after supabase_fraud.sql (API keys),
-- supabase_actions.sql and supabase_workspace_audit.sql. Safe to re-run.
--
-- The bank's app (or website, agent desktop or phone system) posts a claim with
-- an API key from Settings → Connections. It's stored here once per bank
-- reference, lands in Triage → Claims tagged with where it came from, and
-- moves through four statuses the bank can show its customer:
--   received → in_review → with_desk (investigating) | closed
-- api/claims.js writes new claims with the service role; analysts move them on
-- through claim_set, which keeps a history and audits every change.
-- =============================================================================

create table if not exists public.app_claims (
  institution_id uuid not null references public.institutions(id) on delete cascade,
  id             text not null,                       -- CLM-…, from the bank's reference
  external_id    text not null,                       -- the bank's own reference
  channel        text not null default 'app' check (channel in ('app', 'web', 'agent', 'phone')),
  segment        text not null default 'fi' check (segment in ('fi', 'ce')),
  status         text not null default 'received' check (status in ('received', 'in_review', 'with_desk', 'closed')),
  ready          boolean not null default false,      -- complete enough to go straight to the Desk
  data           jsonb not null,                      -- customer, transactions, answers, statement, attachments, consent, clock
  history        jsonb not null default '[]'::jsonb,  -- [{ status, at, by, note, public }]
  case_id        text not null default '',
  reported_at    timestamptz not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (institution_id, id),
  unique (institution_id, external_id)
);
create index if not exists app_claims_open_idx on public.app_claims (institution_id, status, reported_at desc);
alter table public.app_claims enable row level security;

-- Claims for Triage → Claims: everything not closed, plus the last 50 closed
create or replace function public.claims_list()
returns setof public.app_claims
language sql stable security definer set search_path = public as $$
  (select * from app_claims where institution_id = my_institution() and status <> 'closed' order by reported_at asc limit 500)
  union all
  (select * from app_claims where institution_id = my_institution() and status = 'closed' order by updated_at desc limit 50)
$$;

-- Move a claim on. p_public is what the bank may show its customer (optional).
create or replace function public.claim_set(p_id text, p_status text, p_note text default '', p_public text default '', p_case_id text default '')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); cur app_claims; who text;
begin
  perform need_write();
  if p_status not in ('in_review', 'with_desk', 'closed') then raise exception 'Unknown claim status'; end if;
  select * into cur from app_claims where institution_id = me and id = p_id for update;
  if not found then raise exception 'No such claim'; end if;
  if cur.status = 'closed' then raise exception 'This claim is already closed'; end if;
  if cur.status = p_status then return jsonb_build_object('id', cur.id, 'status', cur.status, 'changed', false); end if;
  if p_status = 'closed' and trim(coalesce(p_note, '')) = '' then raise exception 'Say why the claim is closed'; end if;
  select coalesce(nullif(m.display_name, ''), m.email) into who from memberships m where m.user_id = auth.uid() and m.institution_id = me limit 1;
  update app_claims set status = p_status, updated_at = now(),
    case_id = case when coalesce(p_case_id, '') <> '' then left(p_case_id, 120) else case_id end,
    history = history || jsonb_build_array(jsonb_build_object('status', p_status, 'at', now(), 'by', coalesce(who, ''),
      'note', left(trim(coalesce(p_note, '')), 500), 'public', left(trim(coalesce(p_public, '')), 300)))
  where institution_id = me and id = p_id returning * into cur;
  perform audit_add(me, 'claim.status_changed', 'claim', cur.id, jsonb_build_object('status', p_status, 'note', left(trim(coalesce(p_note, '')), 200), 'case', cur.case_id));
  return jsonb_build_object('id', cur.id, 'status', cur.status, 'changed', true);
end $$;

do $$
declare f text;
begin
  foreach f in array array['claims_list()', 'claim_set(text,text,text,text,text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Check
select c.relname as object, c.relrowsecurity as rls_on, null::boolean as anon_can_call
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'app_claims'
union all
select p.proname, null, has_function_privilege('anon', p.oid, 'execute')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('claims_list', 'claim_set');
