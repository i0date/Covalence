-- =============================================================================
-- Covalence — Pre-dispute alerts for merchants (001 Triage → Alerts, Merchant side)
-- =============================================================================
-- Run once in the Supabase SQL editor, after supabase_fraud.sql (API keys),
-- supabase_roles_retention.sql and supabase_workspace_audit.sql. Safe to re-run.
--
-- Ethoca alerts, Verifi CDRN and RDR, Visa Order Insight and Mastercard Consumer
-- Clarity warn a merchant before a cardholder's complaint becomes a chargeback.
-- The merchant's systems post them to /api/intake { "preDispute": [...] } with an
-- API key; they're stored here once per provider alert, and analysts decide in
-- Triage: refund in time (no chargeback, nothing on the ratio), already refunded,
-- let it go to a chargeback (with a reason), or share the order's details. Each
-- decision is audited and sent to the merchant's endpoint (api/action.js) so
-- their systems refund and report the outcome to the provider.
-- Rules: src/preDispute.mjs.
-- =============================================================================

create table if not exists public.predispute_alerts (
  institution_id uuid not null references public.institutions(id) on delete cascade,
  id             text not null,                        -- PDA-…, Covalence's id
  external_id    text not null,                        -- the provider's alert id
  source         text not null check (source in ('ethoca', 'cdrn', 'rdr', 'order_insight', 'consumer_clarity')),
  network        text not null default '',
  amount         numeric(14,2) not null check (amount > 0),
  currency       text not null default 'USD',
  reason         text not null default 'unknown' check (reason in ('fraud', 'dispute', 'unknown')),
  reason_code    text not null default '',
  descriptor     text not null default '',
  order_id       text not null default '',
  arn            text not null default '',
  card_last4     text not null default '',
  transaction_at timestamptz,
  received_at    timestamptz not null,
  respond_by     timestamptz,
  status         text not null default 'open' check (status in ('open', 'refunded', 'already_refunded', 'declined', 'expired', 'rdr_refunded', 'rdr_declined', 'shared')),
  note           text not null default '',
  history        jsonb not null default '[]'::jsonb,   -- [{ status, at, by, note }]
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (institution_id, id),
  unique (institution_id, source, external_id)
);
create index if not exists predispute_open_idx on public.predispute_alerts (institution_id, status, received_at desc);
alter table public.predispute_alerts enable row level security;

-- The open ones, and the last 90 days of the rest. An open alert past its window is
-- shown as expired (and stored as expired the next time it's listed).
create or replace function public.predispute_list()
returns setof public.predispute_alerts
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution();
begin
  update predispute_alerts set status = 'expired', updated_at = now(),
    history = history || jsonb_build_array(jsonb_build_object('status', 'expired', 'at', now(), 'by', 'Covalence', 'note', 'The window passed with no answer'))
  where institution_id = me and status = 'open' and respond_by is not null and respond_by < now();
  return query select * from predispute_alerts where institution_id = me and (status = 'open' or received_at > now() - interval '90 days')
    order by (status = 'open') desc, respond_by asc nulls last, received_at desc limit 500;
end $$;

-- A decision on an open alert
create or replace function public.predispute_act(p_id text, p_action text, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); cur predispute_alerts; who text;
begin
  perform need_write();
  if p_action not in ('refunded', 'already_refunded', 'declined', 'shared') then raise exception 'Unknown decision'; end if;
  select * into cur from predispute_alerts where institution_id = me and id = p_id for update;
  if not found then raise exception 'No such alert'; end if;
  if cur.status <> 'open' then raise exception 'This alert was already decided (%)', cur.status; end if;
  if p_action = 'refunded' and cur.respond_by is not null and cur.respond_by < now() then raise exception 'The window has passed: a refund now won''t stop the chargeback'; end if;
  if p_action = 'declined' and trim(coalesce(p_note, '')) = '' then raise exception 'Say why you''re letting it go to a chargeback'; end if;
  select coalesce(nullif(m.display_name, ''), m.email) into who from memberships m where m.user_id = auth.uid() limit 1;
  update predispute_alerts set status = p_action, updated_at = now(),
    history = history || jsonb_build_array(jsonb_build_object('status', p_action, 'at', now(), 'by', coalesce(who, ''), 'note', left(trim(coalesce(p_note, '')), 300)))
  where institution_id = me and id = p_id returning * into cur;
  perform audit_add(me, 'predispute.' || p_action, 'predispute', cur.id, jsonb_build_object('source', cur.source, 'amount', cur.amount, 'note', left(trim(coalesce(p_note, '')), 200)));
  return jsonb_build_object('id', cur.id, 'status', cur.status, 'changed', true);
end $$;

do $$
declare f text;
begin
  foreach f in array array['predispute_list()', 'predispute_act(text,text,text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
