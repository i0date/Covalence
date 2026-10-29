-- =============================================================================
-- Covalence — linked chargeback cases: stage sync and settling early (Duo)
-- =============================================================================
-- Run once in the Supabase SQL editor, after supabase_arn.sql. Safe to re-run.
--
-- In a Duo session opened by ARN (claim.kind = 'arn'), each side can share its
-- own case's stage with the other ("Chargeback filed", "Merchant responded",
-- "Pre-Arbitration filed"…). A side's stage is visible to the other only while
-- that side has sharing switched on. Each side still records its own status;
-- nothing here changes the other side's case.
--
-- Settling early, instead of working the chargeback through the network:
--   offered    the merchant (or acquirer) offers a refund of an amount
--   agreed     the cardholder's bank agrees to withdraw once it's refunded
--   declined   …or doesn't
--   refunded   the merchant records the refund and its reference
--   withdrawn  the bank records that it withdrew the chargeback — settled
-- Every step is audited for both institutions.
-- =============================================================================

create table if not exists public.duo_arn_state (
  session_id     text not null,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  case_id        text not null default '',
  sync           boolean not null default false,
  stage          text not null default '',
  stage_at       timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (session_id, institution_id)
);
alter table public.duo_arn_state enable row level security;

create table if not exists public.duo_settlements (
  session_id   text primary key,
  status       text not null check (status in ('offered','agreed','declined','refunded','withdrawn')),
  amount       numeric not null check (amount > 0),
  note         text not null default '',
  offered_by   uuid references public.institutions(id) on delete cascade,
  offered_at   timestamptz not null default now(),
  agreed_at    timestamptz,
  refunded_at  timestamptz,
  refund_ref   text not null default '',
  withdrawn_at timestamptz,
  updated_at   timestamptz not null default now()
);
alter table public.duo_settlements enable row level security;

-- This institution's side of an ARN session: 'a' or 'b', or null when it isn't in one
create or replace function public.arn_my_side(s duo_sessions)
returns text language sql stable security definer set search_path = public as $$
  select case when coalesce(s.claim->>'kind', '') <> 'arn' then null
              when my_institution() = s.institution_a_id then 'a'
              when my_institution() = s.institution_b_id then 'b' end
$$;

-- Both sides' shared stages and the settlement, for either institution in the session
create or replace function public.arn_link_state(p_id text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s duo_sessions; me text; them uuid; mine duo_arn_state; theirs duo_arn_state; st duo_settlements;
begin
  select * into s from duo_sessions where id::text = upper(p_id);
  if not found then return null; end if;
  me := arn_my_side(s); if me is null then return null; end if;
  them := case me when 'a' then s.institution_b_id else s.institution_a_id end;
  select * into mine from duo_arn_state where session_id = s.id::text and institution_id = my_institution();
  select * into theirs from duo_arn_state where session_id = s.id::text and institution_id = them;
  select * into st from duo_settlements where session_id = s.id::text;
  return jsonb_build_object(
    'my_side', s.claim->'sides'->>me,
    'their_side', s.claim->'sides'->>(case me when 'a' then 'b' else 'a' end),
    'my_case', s.claim->'cases'->>me,
    'me', jsonb_build_object('sync', coalesce(mine.sync, false), 'stage', mine.stage, 'stage_at', mine.stage_at),
    'them', jsonb_build_object('sync', coalesce(theirs.sync, false),
                               'stage', case when theirs.sync then theirs.stage end, 'stage_at', case when theirs.sync then theirs.stage_at end),
    'settlement', case when st.session_id is null then null else jsonb_build_object(
      'status', st.status, 'amount', st.amount, 'note', st.note, 'by_me', st.offered_by = my_institution(),
      'offered_at', st.offered_at, 'agreed_at', st.agreed_at, 'refunded_at', st.refunded_at, 'refund_ref', st.refund_ref, 'withdrawn_at', st.withdrawn_at) end);
end $$;

-- Share (or stop sharing) this side's case stage; record the current stage
create or replace function public.arn_publish_stage(p_id text, p_stage text, p_sync boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare s duo_sessions; me text;
begin
  perform need_write();
  select * into s from duo_sessions where id::text = upper(p_id);
  if not found then raise exception 'No such session'; end if;
  me := arn_my_side(s); if me is null then raise exception 'Your institution is not part of this linked session'; end if;
  insert into duo_arn_state (session_id, institution_id, case_id, sync, stage, stage_at)
  values (s.id::text, my_institution(), coalesce(s.claim->'cases'->>me, ''), coalesce(p_sync, false), left(coalesce(p_stage, ''), 40), now())
  on conflict (session_id, institution_id) do update set
    sync = excluded.sync,
    stage = excluded.stage,
    stage_at = case when duo_arn_state.stage is distinct from excluded.stage then now() else duo_arn_state.stage_at end,
    updated_at = now();
  perform audit_add(my_institution(), 'duo.stage_synced', 'duo', s.id::text, jsonb_build_object('stage', left(coalesce(p_stage, ''), 40), 'shared', coalesce(p_sync, false)));
end $$;

-- One step of settling early. Who may take which step depends on the side.
create or replace function public.arn_settle(p_id text, p_action text, p_amount numeric default null, p_ref text default '', p_note text default '')
returns void
language plpgsql security definer set search_path = public as $$
declare s duo_sessions; me text; side text; st duo_settlements; merchant boolean; inst uuid := my_institution(); other uuid;
begin
  perform need_write();
  select * into s from duo_sessions where id::text = upper(p_id) for update;
  if not found then raise exception 'No such session'; end if;
  me := arn_my_side(s); if me is null then raise exception 'Your institution is not part of this linked session'; end if;
  side := s.claim->'sides'->>me; merchant := side in ('merchant', 'acquirer');
  other := case me when 'a' then s.institution_b_id else s.institution_a_id end;
  select * into st from duo_settlements where session_id = s.id::text;
  if p_action = 'offer' then
    if not merchant then raise exception 'The merchant side offers the refund'; end if;
    if st.session_id is not null and st.status not in ('declined') then raise exception 'There’s already an offer in this session'; end if;
    if p_amount is null or p_amount <= 0 then raise exception 'Enter the refund amount'; end if;
    insert into duo_settlements (session_id, status, amount, note, offered_by) values (s.id::text, 'offered', p_amount, left(coalesce(p_note, ''), 300), inst)
    on conflict (session_id) do update set status = 'offered', amount = excluded.amount, note = excluded.note, offered_by = inst, offered_at = now(),
      agreed_at = null, refunded_at = null, refund_ref = '', withdrawn_at = null, updated_at = now();
  elsif p_action in ('agree', 'decline') then
    if merchant then raise exception 'The cardholder’s bank answers the offer'; end if;
    if st.status is distinct from 'offered' then raise exception 'There’s no offer waiting for an answer'; end if;
    update duo_settlements set status = case p_action when 'agree' then 'agreed' else 'declined' end,
      agreed_at = case p_action when 'agree' then now() end, updated_at = now() where session_id = s.id::text;
  elsif p_action = 'refunded' then
    if not merchant then raise exception 'The merchant side records the refund'; end if;
    if st.status is distinct from 'agreed' then raise exception 'The bank hasn’t agreed yet'; end if;
    if trim(coalesce(p_ref, '')) = '' then raise exception 'Enter the refund reference'; end if;
    update duo_settlements set status = 'refunded', refunded_at = now(), refund_ref = left(trim(p_ref), 80), updated_at = now() where session_id = s.id::text;
  elsif p_action = 'withdrawn' then
    if merchant then raise exception 'The cardholder’s bank withdraws the chargeback'; end if;
    if st.status is distinct from 'refunded' then raise exception 'The refund hasn’t been recorded yet'; end if;
    update duo_settlements set status = 'withdrawn', withdrawn_at = now(), updated_at = now() where session_id = s.id::text;
  else
    raise exception 'Unknown step';
  end if;
  perform audit_add(inst, 'duo.settle_' || p_action, 'duo', s.id::text, jsonb_build_object('amount', coalesce(p_amount, st.amount), 'ref', nullif(trim(coalesce(p_ref, '')), '')));
  perform audit_add(other, 'duo.settle_' || p_action, 'duo', s.id::text, jsonb_build_object('amount', coalesce(p_amount, st.amount), 'by', (select name from institutions where id = inst)));
end $$;

do $$
declare f text;
begin
  foreach f in array array['arn_link_state(text)','arn_publish_stage(text,text,boolean)','arn_settle(text,text,numeric,text,text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public.arn_my_side(public.duo_sessions) from public, anon, authenticated';
end $$;

-- Check
select c.relname as object, c.relrowsecurity as rls_on, null::boolean as anon_can_call
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('duo_arn_state', 'duo_settlements')
union all
select p.proname, null, has_function_privilege('anon', p.oid, 'execute')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('arn_my_side', 'arn_link_state', 'arn_publish_stage', 'arn_settle');
