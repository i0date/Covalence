-- =============================================================================
-- Covalence — acting on alerts in the institution's own systems, and alert
-- notifications
-- =============================================================================
-- Run once in the Supabase SQL editor, after supabase_fraud.sql. Safe to re-run.
--
-- action_endpoints  one row per institution:
--                   url        where Covalence POSTs signed events — an analyst
--                              pressing Hold / Block / Lock (action.requested),
--                              and new alerts (alert.created)
--                   secret     signs every event (HMAC-SHA256); shown once
--                   slack_url  a Slack incoming webhook for new alerts
--                   notify_min the lowest severity that notifies
-- Secrets never leave the database through these functions: the settings
-- screen sees only whether they are set. api/action.js and api/intake.js read
-- the row with the service role.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.action_endpoints (
  institution_id uuid primary key references public.institutions(id) on delete cascade,
  url            text not null default '' check (url = '' or url ~ '^https://[^\s/]+'),
  secret         text not null default '',
  slack_url      text not null default '' check (slack_url = '' or slack_url ~ '^https://hooks\.slack\.com/'),
  notify_min     text not null default 'high' check (notify_min in ('high','medium','low','off')),
  updated_at     timestamptz not null default now(),
  updated_by     uuid default auth.uid()
);
alter table public.action_endpoints enable row level security;

-- What the settings screen shows (no secrets)
create or replace function public.action_endpoint_get()
returns table (url text, has_secret boolean, slack_set boolean, notify_min text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.url, e.secret <> '', e.slack_url <> '', e.notify_min, e.updated_at from action_endpoints e
  where e.institution_id = my_institution() and can_configure()
$$;

-- Save the endpoint and notification settings. Admins only.
-- p_slack_url: null keeps the saved one, '' removes it.
create or replace function public.action_endpoint_set(p_url text, p_slack_url text, p_notify_min text)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution();
begin
  if me is null or my_role() <> 'admin' then raise exception 'Only an institution admin can change connections'; end if;
  insert into action_endpoints (institution_id, url, slack_url, notify_min)
  values (me, trim(coalesce(p_url, '')), trim(coalesce(p_slack_url, '')), coalesce(p_notify_min, 'high'))
  on conflict (institution_id) do update set
    url = excluded.url,
    slack_url = case when p_slack_url is null then action_endpoints.slack_url else excluded.slack_url end,
    notify_min = excluded.notify_min, updated_at = now(), updated_by = auth.uid();
  perform audit_add(me, 'connection.updated', 'workspace', 'action_endpoint',
    jsonb_build_object('url', trim(coalesce(p_url, '')), 'slack', case when p_slack_url is null then 'unchanged' when trim(p_slack_url) = '' then 'removed' else 'set' end, 'notify', p_notify_min));
end $$;

-- A new signing secret, returned once. Admins only.
create or replace function public.action_secret_rotate()
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := my_institution(); s text;
begin
  if me is null or my_role() <> 'admin' then raise exception 'Only an institution admin can change connections'; end if;
  s := 'whsec_' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into action_endpoints (institution_id, secret) values (me, s)
  on conflict (institution_id) do update set secret = s, updated_at = now(), updated_by = auth.uid();
  perform audit_add(me, 'connection.secret_rotated', 'workspace', 'action_endpoint', '{}'::jsonb);
  return s;
end $$;

-- Is data arriving? Any member can see this (Triage and Licit show it)
create or replace function public.intake_status()
returns table (active_keys integer, last_received timestamptz)
language sql stable security definer set search_path = public as $$
  select count(*) filter (where k.revoked_at is null)::integer, max(k.last_used_at) from intake_keys k
  where k.institution_id = my_institution()
$$;

do $$
declare f text;
begin
  foreach f in array array['action_endpoint_get()','action_endpoint_set(text,text,text)','action_secret_rotate()','intake_status()']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Check
select c.relname as object, c.relrowsecurity as rls_on, null::boolean as anon_can_call
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'action_endpoints'
union all
select p.proname, null, has_function_privilege('anon', p.oid, 'execute')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and (p.proname like 'action\_%' or p.proname = 'intake_status');
