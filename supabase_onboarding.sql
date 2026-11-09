-- =============================================================================
-- Covalence — Onboard with Covalence: a bank's new customers (005 Licit → Onboarding)
-- =============================================================================
-- Run once in the Supabase SQL editor, after supabase_claim_links.sql (the bank's
-- name and logo), supabase_actions.sql (the bank's endpoint), supabase_fraud.sql
-- (API keys), supabase_roles_retention.sql and supabase_workspace_audit.sql. Safe to re-run.
--
-- A person or a business applies through the bank's app (POST /api/onboarding
-- { application }) or the hosted form (/onboard/<token>, a link from POST
-- /api/onboarding { link }). api/_onboarding.js runs the checks (src/onboarding.mjs),
-- stores the application here, and the bank's compliance team decides in Licit.
--   • ID numbers are never stored: they go straight to the bank's endpoint, and only
--     the last four digits are kept on the applicant
--   • A link is a random token; only its SHA-256 hash is stored; it works once and expires
--   • Links and applications are written only by api/_onboarding.js, with the service role
-- =============================================================================

create table if not exists public.onboarding_links (
  id             text primary key,                    -- ONL-…
  token_hash     text not null unique,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  reference      text not null default '',            -- the bank's own reference
  kind           text not null default 'person' check (kind in ('person', 'business')),
  prefill        jsonb not null default '{}'::jsonb,
  created_by     text not null default '',
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  opened_at      timestamptz,
  used_at        timestamptz,
  app_id         text not null default '',
  revoked_at     timestamptz
);
create index if not exists onboarding_links_inst_idx on public.onboarding_links (institution_id, created_at desc);
alter table public.onboarding_links enable row level security;

create table if not exists public.onboarding_apps (
  institution_id uuid not null references public.institutions(id) on delete cascade,
  id             text not null,                        -- ONB-…
  reference      text not null default '',
  kind           text not null check (kind in ('person', 'business')),
  channel        text not null default 'api' check (channel in ('api', 'form')),
  applicant      jsonb not null,                       -- the application, with no full ID numbers
  checks         jsonb not null default '[]'::jsonb,   -- [{ key, label, state, detail }]
  rating         text not null default 'low' check (rating in ('low', 'medium', 'high')),
  reasons        jsonb not null default '[]'::jsonb,
  recommend      jsonb not null default '{}'::jsonb,
  status         text not null default 'to_review' check (status in ('waiting_idv', 'to_review', 'on_hold', 'more_info', 'approved', 'declined')),
  idv            jsonb,                                -- { result, provider, reference, at }
  match_keys     text[] not null default '{}',         -- hashed email / phone / address / ip, for duplicates
  history        jsonb not null default '[]'::jsonb,   -- [{ status, at, by, note }]
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (institution_id, id)
);
create index if not exists onboarding_apps_open_idx on public.onboarding_apps (institution_id, status, created_at desc);
create index if not exists onboarding_apps_ref_idx on public.onboarding_apps (institution_id, reference);
create index if not exists onboarding_apps_keys_idx on public.onboarding_apps using gin (match_keys);
alter table public.onboarding_apps enable row level security;

-- The open ones, and the last 180 days of the rest
create or replace function public.onboarding_list()
returns setof public.onboarding_apps
language sql stable security definer set search_path = public as $$
  select * from onboarding_apps where institution_id = my_institution()
    and (status in ('waiting_idv', 'to_review', 'on_hold', 'more_info') or created_at > now() - interval '180 days')
  order by (status in ('waiting_idv', 'to_review', 'on_hold', 'more_info')) desc, created_at desc limit 500;
$$;

-- A decision: approve, ask for more, or decline. Approving needs the ID check passed and no
-- possible sanctions match; a high rating needs a note (the enhanced due diligence done).
create or replace function public.onboarding_decide(p_id text, p_action text, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); cur onboarding_apps; who text; next text; note text := left(trim(coalesce(p_note, '')), 500);
begin
  perform need_write();
  if p_action not in ('approve', 'more_info', 'decline') then raise exception 'Unknown decision'; end if;
  select * into cur from onboarding_apps where institution_id = me and id = p_id for update;
  if not found then raise exception 'No such application'; end if;
  if cur.status in ('approved', 'declined') then raise exception 'This application was already decided (%)', cur.status; end if;
  if p_action = 'approve' and cur.status = 'on_hold' then raise exception 'Clear the possible sanctions match before approving'; end if;
  if p_action = 'approve' and coalesce(cur.idv->>'result', '') <> 'passed' then raise exception 'Approve once the identity check has passed'; end if;
  if p_action = 'approve' and cur.rating = 'high' and note = '' then raise exception 'A high-risk approval needs a note: what enhanced due diligence was done'; end if;
  if p_action in ('more_info', 'decline') and note = '' then raise exception 'Say what you need, or why it''s declined'; end if;
  next := case p_action when 'approve' then 'approved' when 'decline' then 'declined' else 'more_info' end;
  select coalesce(nullif(m.display_name, ''), m.email) into who from memberships m where m.user_id = auth.uid() limit 1;
  update onboarding_apps set status = next, updated_at = now(),
    history = history || jsonb_build_array(jsonb_build_object('status', next, 'at', now(), 'by', coalesce(who, ''), 'note', note))
  where institution_id = me and id = p_id returning * into cur;
  perform audit_add(me, 'onboarding.' || next, 'onboarding', cur.id, jsonb_build_object('rating', cur.rating, 'note', left(note, 200)));
  return jsonb_build_object('id', cur.id, 'status', cur.status, 'changed', true);
end $$;

-- Clearing a possible sanctions match (a false positive) puts it back for review; the rating is
-- kept as it was (it may have been high only for the match), so a high one still needs a note to approve
create or replace function public.onboarding_clear_hold(p_id text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); cur onboarding_apps; who text; note text := left(trim(coalesce(p_note, '')), 500);
begin
  perform need_write();
  if note = '' then raise exception 'Say why it isn''t a match'; end if;
  select * into cur from onboarding_apps where institution_id = me and id = p_id for update;
  if not found then raise exception 'No such application'; end if;
  if cur.status <> 'on_hold' then raise exception 'This application isn''t on hold'; end if;
  select coalesce(nullif(m.display_name, ''), m.email) into who from memberships m where m.user_id = auth.uid() limit 1;
  update onboarding_apps set status = case when idv is null then 'waiting_idv' else 'to_review' end, updated_at = now(),
    checks = coalesce((select jsonb_agg(case when c->>'key' = 'sanctions' then c || jsonb_build_object('state', 'pass', 'detail', 'Cleared as a false positive: ' || note) else c end) from jsonb_array_elements(checks) c), '[]'::jsonb),
    reasons = coalesce((select jsonb_agg(r) from jsonb_array_elements(reasons) r where r #>> '{}' <> 'A possible sanctions match'), '[]'::jsonb),
    recommend = jsonb_build_object('action', case when idv is null then 'wait' when rating = 'high' then 'edd' else 'review' end,
      'why', 'The possible sanctions match was cleared as a false positive. The rating is kept as it was: look at the remaining reasons.'),
    history = history || jsonb_build_array(jsonb_build_object('status', 'cleared', 'at', now(), 'by', coalesce(who, ''), 'note', note))
  where institution_id = me and id = p_id returning * into cur;
  perform audit_add(me, 'onboarding.hold_cleared', 'onboarding', cur.id, jsonb_build_object('note', left(note, 200)));
  return jsonb_build_object('id', cur.id, 'status', cur.status, 'changed', true);
end $$;

do $$
declare f text;
begin
  foreach f in array array['onboarding_list()', 'onboarding_decide(text,text,text)', 'onboarding_clear_hold(text,text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
