-- =============================================================================
-- Covalence — fraud alerts (001 Triage → Alerts) and direct connections
-- =============================================================================
-- Run once in the Supabase SQL editor, after supabase_monitoring.sql.
-- Safe to re-run.
--
-- tm_events      account events (logins, new devices, profile changes, new
--                payees) — what the account-takeover rule reads
-- intake_keys    API keys an institution's own systems use to send
--                transactions, events and alerts straight to Covalence
--                (api/intake.js). Only a SHA-256 hash of each key is stored;
--                the key itself is shown once, when it's created.
-- Same pattern as before: RLS on with no policies, institution-scoped
-- functions, writers only for changes, admins only for keys.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.tm_events (
  institution_id uuid not null references public.institutions(id) on delete cascade,
  id             text not null check (length(id) between 1 and 120),
  customer_id    text not null check (length(customer_id) between 1 and 120),
  ts             timestamptz not null,
  type           text not null default 'other',
  raw_type       text not null default '',
  device         text not null default '',
  location       text not null default '',
  detail         text not null default '',
  batch          text not null default '',
  imported_at    timestamptz not null default now(),
  primary key (institution_id, id)
);
create index if not exists tm_events_customer_idx on public.tm_events (institution_id, customer_id, ts);
alter table public.tm_events enable row level security;
create index if not exists tm_tx_name_idx on public.tm_transactions (institution_id, lower(customer_name), ts);

create or replace function public.tm_events_ingest(p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); n integer;
begin
  perform need_write();
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 1000 then raise exception 'Send at most 1000 events at a time'; end if;
  insert into tm_events (institution_id, id, customer_id, ts, type, raw_type, device, location, detail, batch)
  select me, r->>'id', r->>'customerId', (r->>'ts')::timestamptz, coalesce(r->>'type', 'other'), left(coalesce(r->>'rawType', ''), 80),
         left(coalesce(r->>'device', ''), 120), left(coalesce(r->>'location', ''), 80), left(coalesce(r->>'detail', ''), 200), coalesce(r->>'batch', '')
  from jsonb_array_elements(p_rows) r
  on conflict (institution_id, id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.tm_events_window(p_customers text[], p_since timestamptz)
returns table (id text, "customerId" text, ts timestamptz, type text, "rawType" text, device text, location text, detail text)
language sql stable security definer set search_path = public as $$
  select e.id, e.customer_id, e.ts, e.type, e.raw_type, e.device, e.location, e.detail from tm_events e
  where e.institution_id = my_institution() and e.customer_id = any (p_customers[1:5000]) and e.ts >= p_since
  order by e.customer_id, e.ts limit 50000
$$;

-- Card transactions of named customers (the compromised-merchant rule looks up confirmed fraud victims by name)
create or replace function public.tm_window_names(p_names text[], p_since timestamptz)
returns table (id text, "customerId" text, "customerName" text, ts timestamptz, amount numeric, currency text, direction text,
               channel text, counterparty text, "counterpartyAccount" text, country text, wallet text, description text, batch text)
language sql stable security definer set search_path = public as $$
  select t.id, t.customer_id, t.customer_name, t.ts, t.amount, t.currency, t.direction, t.channel, t.counterparty,
         t.counterparty_account, t.country, t.wallet, t.description, t.batch
  from tm_transactions t
  where t.institution_id = my_institution() and lower(t.customer_name) = any (select lower(x) from unnest(p_names[1:500]) x)
    and t.ts >= p_since and t.channel = 'card'
  order by t.customer_name, t.ts limit 50000
$$;

-- ── API keys for direct connections ──
create table if not exists public.intake_keys (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  label          text not null check (length(label) between 1 and 80),
  key_hash       text not null unique,
  prefix         text not null,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz,
  revoked_at     timestamptz
);
create index if not exists intake_keys_inst_idx on public.intake_keys (institution_id);
alter table public.intake_keys enable row level security;

-- Create a key; returns it once (only its hash is kept). Admins only.
create or replace function public.intake_key_create(p_label text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := my_institution(); k text;
begin
  if me is null or my_role() <> 'admin' then raise exception 'Only an institution admin can create API keys'; end if;
  if (select count(*) from intake_keys where institution_id = me and revoked_at is null) >= 10 then raise exception 'At most 10 active keys — revoke one first'; end if;
  k := 'cvl_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into intake_keys (institution_id, label, key_hash, prefix)
  values (me, left(trim(coalesce(nullif(p_label, ''), 'API key')), 80), encode(extensions.digest(k, 'sha256'), 'hex'), left(k, 12));
  perform audit_add(me, 'intake_key.created', 'workspace', left(k, 12), jsonb_build_object('label', p_label));
  return k;
end $$;

create or replace function public.intake_keys_list()
returns table (id uuid, label text, prefix text, created_at timestamptz, last_used_at timestamptz, revoked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select k.id, k.label, k.prefix, k.created_at, k.last_used_at, k.revoked_at from intake_keys k
  where k.institution_id = my_institution() and can_configure() order by k.created_at desc
$$;

create or replace function public.intake_key_revoke(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); px text;
begin
  if me is null or my_role() <> 'admin' then raise exception 'Only an institution admin can revoke API keys'; end if;
  update intake_keys set revoked_at = now() where id = p_id and institution_id = me and revoked_at is null returning prefix into px;
  if px is not null then perform audit_add(me, 'intake_key.revoked', 'workspace', px, '{}'::jsonb); end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['tm_events_ingest(jsonb)','tm_events_window(text[],timestamptz)','tm_window_names(text[],timestamptz)',
                           'intake_key_create(text)','intake_keys_list()','intake_key_revoke(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Check
select c.relname as object, c.relrowsecurity as rls_on, null::boolean as anon_can_call
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('tm_events', 'intake_keys')
union all
select p.proname, null, has_function_privilege('anon', p.oid, 'execute')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and (p.proname like 'tm\_events%' or p.proname like 'intake\_key%' or p.proname = 'tm_window_names');
