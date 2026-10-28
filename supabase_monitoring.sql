-- =============================================================================
-- Covalence — transaction monitoring (005 Licit → Alerts)
-- =============================================================================
-- Run once in the Supabase SQL editor, after supabase_roles_retention.sql.
-- Safe to re-run.
--
-- tm_transactions  every imported transaction, per institution; a transaction
--                  id is stored once (re-importing a file adds nothing)
-- tm_alerts        alerts raised by the rules (src/monitoring.mjs); an alert id
--                  is stable, so re-running a file doesn't raise it twice
-- Both tables have row-level security on and no policies: the app reaches them
-- only through the functions below, which scope everything to my_institution()
-- and require a writer role (need_write) for changes. Auditors can read.
-- =============================================================================

create table if not exists public.tm_transactions (
  institution_id       uuid not null references public.institutions(id) on delete cascade,
  id                   text not null check (length(id) between 1 and 120),
  customer_id          text not null check (length(customer_id) between 1 and 120),
  customer_name        text not null default '',
  ts                   timestamptz not null,
  amount               numeric(18,2) not null check (amount >= 0),
  currency             text not null default 'USD',
  direction            text not null check (direction in ('in','out')),
  channel              text not null default 'other',
  counterparty         text not null default '',
  counterparty_account text not null default '',
  country              text not null default '',
  wallet               text not null default '',
  description          text not null default '',
  batch                text not null default '',
  imported_at          timestamptz not null default now(),
  imported_by          uuid default auth.uid(),
  primary key (institution_id, id)
);
create index if not exists tm_tx_customer_idx on public.tm_transactions (institution_id, customer_id, ts);
create index if not exists tm_tx_batch_idx on public.tm_transactions (institution_id, batch);
alter table public.tm_transactions enable row level security;

create table if not exists public.tm_alerts (
  institution_id uuid not null references public.institutions(id) on delete cascade,
  id             text not null,
  data           jsonb not null,
  status         text not null default 'open' check (status in ('open','closed','escalated')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (institution_id, id)
);
create index if not exists tm_alerts_status_idx on public.tm_alerts (institution_id, status, created_at desc);
alter table public.tm_alerts enable row level security;

-- Store a batch of transactions (≤ 1000); returns how many were new
create or replace function public.tm_ingest(p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); n integer;
begin
  perform need_write();
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 1000 then raise exception 'Send at most 1000 transactions at a time'; end if;
  insert into tm_transactions (institution_id, id, customer_id, customer_name, ts, amount, currency, direction, channel,
                               counterparty, counterparty_account, country, wallet, description, batch)
  select me, r->>'id', r->>'customerId', coalesce(r->>'customerName', ''), (r->>'ts')::timestamptz, (r->>'amount')::numeric,
         coalesce(nullif(r->>'currency', ''), 'USD'), r->>'direction', coalesce(r->>'channel', 'other'), coalesce(r->>'counterparty', ''),
         coalesce(r->>'counterpartyAccount', ''), coalesce(r->>'country', ''), coalesce(r->>'wallet', ''), left(coalesce(r->>'description', ''), 300),
         coalesce(r->>'batch', '')
  from jsonb_array_elements(p_rows) r
  on conflict (institution_id, id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- The customers' recent transactions, for the rules (≤ 5000 customers, ≤ 100k rows)
create or replace function public.tm_window(p_customers text[], p_since timestamptz)
returns table (id text, "customerId" text, "customerName" text, ts timestamptz, amount numeric, currency text, direction text,
               channel text, counterparty text, "counterpartyAccount" text, country text, wallet text, description text, batch text)
language sql stable security definer set search_path = public as $$
  select t.id, t.customer_id, t.customer_name, t.ts, t.amount, t.currency, t.direction, t.channel, t.counterparty,
         t.counterparty_account, t.country, t.wallet, t.description, t.batch
  from tm_transactions t
  where t.institution_id = my_institution()
    and t.customer_id = any (p_customers[1:5000])
    and t.ts >= p_since
  order by t.customer_id, t.ts
  limit 100000
$$;

-- Imports so far (one row per file)
create or replace function public.tm_batches()
returns table (batch text, transactions bigint, customers bigint, first_ts timestamptz, last_ts timestamptz, imported_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.batch, count(*), count(distinct t.customer_id), min(t.ts), max(t.ts), max(t.imported_at)
  from tm_transactions t where t.institution_id = my_institution()
  group by t.batch order by max(t.imported_at) desc limit 100
$$;

-- Add alerts (≤ 1000); an alert already raised is left as it is
create or replace function public.tm_alerts_add(p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); n integer;
begin
  perform need_write();
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 1000 then raise exception 'Send at most 1000 alerts at a time'; end if;
  insert into tm_alerts (institution_id, id, data, status)
  select me, r->>'id', r, 'open' from jsonb_array_elements(p_rows) r
  on conflict (institution_id, id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.tm_alerts_list(p_status text default null, p_limit integer default 500)
returns table (id text, data jsonb, status text, created_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.data, a.status, a.created_at, a.updated_at from tm_alerts a
  where a.institution_id = my_institution() and (p_status is null or a.status = p_status)
  order by a.created_at desc limit least(greatest(coalesce(p_limit, 500), 1), 2000)
$$;

-- Close or escalate an alert, recording who and why in its data
create or replace function public.tm_alert_set(p_id text, p_status text, p_patch jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform need_write();
  if p_status not in ('open','closed','escalated') then raise exception 'Unknown alert status'; end if;
  update tm_alerts set status = p_status, data = data || coalesce(p_patch, '{}'::jsonb), updated_at = now()
  where institution_id = my_institution() and id = p_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['tm_ingest(jsonb)','tm_window(text[],timestamptz)','tm_batches()','tm_alerts_add(jsonb)',
                           'tm_alerts_list(text,integer)','tm_alert_set(text,text,jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Check: tables locked down, functions callable only when signed in
select c.relname as object, c.relrowsecurity as rls_on, null::boolean as anon_can_call
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('tm_transactions', 'tm_alerts')
union all
select p.proname, null, has_function_privilege('anon', p.oid, 'execute')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'tm\_%';
