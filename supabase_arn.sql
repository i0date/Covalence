-- =============================================================================
-- Covalence — linking an issuer's case and a merchant's case by ARN (Duo)
-- =============================================================================
-- Run once in the Supabase SQL editor, after supabase_314b.sql. Safe to re-run.
--
-- The Acquirer Reference Number travels with every card chargeback, so the
-- cardholder's bank and the merchant both hold it. When both use Covalence:
--   1. Either side presses "Find the other side" on a case with an ARN.
--   2. arn_find_other_side looks for a case on the opposite side (issuer vs
--      merchant / acquirer) with the same ARN and an amount within 2%. If it
--      finds one, the other institution gets an invite. The sender is never
--      told whether a match exists.
--   3. The other institution accepts (a Duo session opens for both, linked to
--      both cases) or declines (nothing is shared).
-- Invites store a hash of the ARN, never the ARN; each side's case keeps its own.
-- Bank–merchant sessions are dispute coordination, not 314(b) sharing:
-- duo_sharing_status says so, and the require-both rule doesn't block them.
-- Lookups: 30 an hour per person.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create index if not exists cov_cases_arn_idx on public.cov_cases ((data->>'arn')) where data ? 'arn';

create table if not exists public.duo_arn_invites (
  id                  uuid primary key default gen_random_uuid(),
  arn_hash            text not null,
  from_institution_id uuid not null references public.institutions(id) on delete cascade,
  from_case_id        text not null,
  from_side           text not null check (from_side in ('issuer','acquirer','merchant')),
  to_institution_id   uuid not null references public.institutions(id) on delete cascade,
  to_case_id          text not null,
  status              text not null default 'pending' check (status in ('pending','accepted','declined')),
  session_id          text,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  responded_at        timestamptz,
  unique (from_institution_id, from_case_id, to_institution_id)
);
create index if not exists duo_arn_invites_to on public.duo_arn_invites (to_institution_id, status);
alter table public.duo_arn_invites enable row level security;

create or replace function public.case_side(d jsonb)
returns text language sql immutable as $$
  select case when d->>'side' in ('issuer','acquirer','merchant') then d->>'side' when d->>'mode' = 'merchant' then 'merchant' else 'issuer' end
$$;
create or replace function public.case_amount(d jsonb)
returns numeric language sql immutable as $$
  select nullif(regexp_replace(coalesce(d->>'amount', ''), '[^0-9.]', '', 'g'), '')::numeric
$$;
create or replace function public.duo_is_coordination(c jsonb)
returns boolean language sql immutable as $$
  select coalesce(c->>'kind', '') = 'arn' and (c->'sides'->>'a' in ('merchant','acquirer') or c->'sides'->>'b' in ('merchant','acquirer'))
$$;

-- Look for the other side of this case's dispute; invite them if they're here
create or replace function public.arn_find_other_side(p_case_id text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := my_institution(); d jsonb; a text; amt numeric; mine text;
begin
  perform need_write();
  select data into d from cov_cases where id = p_case_id and institution_id = me;
  if not found then raise exception 'This case hasn’t synced yet — try again in a moment'; end if;
  a := d->>'arn';
  if a is null or a !~ '^[0-9]{23}$' then raise exception 'Add the case’s 23-digit ARN first'; end if;
  if (select count(*) from duo_arn_invites where created_by = auth.uid() and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many lookups — try again in an hour';
  end if;
  mine := case_side(d); amt := case_amount(d);
  insert into duo_arn_invites (arn_hash, from_institution_id, from_case_id, from_side, to_institution_id, to_case_id)
  select encode(digest(a, 'sha256'), 'hex'), me, p_case_id, mine, c.institution_id, c.id
  from cov_cases c
  where c.data->>'arn' = a and c.institution_id is not null and c.institution_id <> me
    and (case when mine = 'issuer' then case_side(c.data) in ('merchant','acquirer') else case_side(c.data) = 'issuer' end)
    and (amt is null or case_amount(c.data) is null or abs(case_amount(c.data) - amt) <= greatest(1, amt * 0.02))
  limit 3
  on conflict (from_institution_id, from_case_id, to_institution_id) do nothing;
  perform audit_add(me, 'duo.arn_lookup', 'case', p_case_id, jsonb_build_object('arn_last4', right(a, 4)));
  return jsonb_build_object('sent', true);
end $$;

-- Invites to this institution, and its own invites once accepted (a pending or
-- declined outgoing invite isn't shown: that would tell the sender a match exists)
create or replace function public.arn_invites()
returns table (id uuid, direction text, status text, my_case_id text, other_institution text, other_side text,
               arn_last4 text, amount text, network text, session_id text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, 'in', i.status, i.to_case_id, f.name, i.from_side, right(c.data->>'arn', 4), c.data->>'amount', c.data->>'network', i.session_id, i.created_at
  from duo_arn_invites i join institutions f on f.id = i.from_institution_id
  left join cov_cases c on c.id = i.to_case_id and c.institution_id = i.to_institution_id
  where i.to_institution_id = my_institution()
  union all
  select i.id, 'out', i.status, i.from_case_id, t.name, case_side(c2.data), right(c.data->>'arn', 4), c.data->>'amount', c.data->>'network', i.session_id, i.created_at
  from duo_arn_invites i join institutions t on t.id = i.to_institution_id
  left join cov_cases c on c.id = i.from_case_id and c.institution_id = i.from_institution_id
  left join cov_cases c2 on c2.id = i.to_case_id and c2.institution_id = i.to_institution_id
  where i.from_institution_id = my_institution() and i.status = 'accepted'
  order by created_at desc
  limit 200
$$;

-- Accept (a Duo session opens, linked to both cases) or decline
create or replace function public.arn_invite_respond(p_id uuid, p_accept boolean)
returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); i duo_arn_invites; mine jsonb; code text; chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; n int := 0;
begin
  perform need_write();
  select * into i from duo_arn_invites where id = p_id and to_institution_id = me and status = 'pending' for update;
  if not found then raise exception 'That invite isn’t waiting for an answer'; end if;
  if not p_accept then
    update duo_arn_invites set status = 'declined', responded_at = now() where id = i.id;
    perform audit_add(me, 'duo.arn_declined', 'case', i.to_case_id, '{}'::jsonb);
    return null;
  end if;
  select data into mine from cov_cases where id = i.to_case_id and institution_id = me;
  loop
    code := ''; for k in 1..6 loop code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1); end loop;
    exit when not exists (select 1 from duo_sessions where id::text = code);
    n := n + 1; if n > 20 then raise exception 'Couldn’t open a session — try again'; end if;
  end loop;
  insert into duo_sessions (id, institution_a, institution_b, institution_a_id, institution_b_id, claim, notes_a, notes_b, status)
  values (code, (select name from institutions where id = i.from_institution_id), (select name from institutions where id = me), i.from_institution_id, me,
          jsonb_build_object('kind', 'arn', 'arn', '…' || right(coalesce(mine->>'arn', ''), 4), 'amount', mine->>'amount', 'network', mine->>'network',
                             'reasonCode', mine->>'reasonCode', 'sides', jsonb_build_object('a', i.from_side, 'b', case_side(mine)),
                             'cases', jsonb_build_object('a', i.from_case_id, 'b', i.to_case_id)),
          '[]', '[]', 'active');
  update duo_arn_invites set status = 'accepted', responded_at = now(), session_id = code where id = i.id;
  perform audit_add(me, 'duo.arn_linked', 'case', i.to_case_id, jsonb_build_object('session', code));
  perform audit_add(i.from_institution_id, 'duo.arn_linked', 'case', i.from_case_id, jsonb_build_object('session', code));
  return code;
end $$;

-- From supabase_314b.sql, now telling a bank–merchant session apart
create or replace function public.duo_sharing_status(p_id text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := my_institution(); s duo_sessions;
begin
  select * into s from duo_sessions where id::text = upper(p_id);
  if not found or me is null or (me is distinct from s.institution_a_id and me is distinct from s.institution_b_id) then return null; end if;
  return jsonb_build_object(
    'a', (select jsonb_build_object('institution', s.institution_a, 'registered', i.registered, 'expires_on', i.expires_on, 'valid', sharing_valid(s.institution_a_id),
                                    'contact_name', i.contact_name, 'contact_email', i.contact_email)
          from (select 1) x left join info_sharing i on i.institution_id = s.institution_a_id),
    'b', case when s.institution_b_id is null then null else
         (select jsonb_build_object('institution', s.institution_b, 'registered', i.registered, 'expires_on', i.expires_on, 'valid', sharing_valid(s.institution_b_id),
                                    'contact_name', i.contact_name, 'contact_email', i.contact_email)
          from (select 1) x left join info_sharing i on i.institution_id = s.institution_b_id) end,
    'safe_harbor', s.institution_b_id is not null and sharing_valid(s.institution_a_id) and sharing_valid(s.institution_b_id),
    'coordination', duo_is_coordination(s.claim),
    'require_both', coalesce((select require_both from info_sharing where institution_id = me), false),
    'purpose', (select jsonb_build_object('at', l.at, 'by', coalesce(m.display_name, m.email, ''), 'text', l.detail->>'purpose')
                from duo_sharing_log l left join memberships m on m.user_id = l.user_id and m.institution_id = me
                where l.session_id = s.id::text and l.institution_id = me and l.kind = 'purpose' order by l.at desc limit 1),
    'log', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'at', l.at, 'safe_harbor', l.safe_harbor, 'by', coalesce(m.display_name, m.email, ''), 'detail', l.detail) order by l.at desc)
                     from (select * from duo_sharing_log where session_id = s.id::text and institution_id = me order by at desc limit 100) l
                     left join memberships m on m.user_id = l.user_id and m.institution_id = me), '[]'::jsonb));
end $$;

-- From supabase_314b.sql: the require-both rule doesn't block dispute coordination
create or replace function public.duo_update(p_id text, p jsonb)
returns setof public.duo_sessions
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); cur duo_sessions; r duo_sessions; legacy boolean; side text; shared boolean; covered boolean; other text;
begin
  perform need_write();
  select * into cur from duo_sessions where id::text = upper(p_id);
  if not found then return; end if;
  legacy := cur.institution_a_id is null;
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

  if not legacy then
    side    := case when me = cur.institution_a_id then 'a' else 'b' end;
    shared  := case side when 'a' then r.notes_a is distinct from cur.notes_a else r.notes_b is distinct from cur.notes_b end;
    covered := cur.institution_b_id is not null and sharing_valid(cur.institution_a_id) and sharing_valid(cur.institution_b_id);
    other   := case side when 'a' then cur.institution_b else cur.institution_a end;
    if shared then
      if not exists (select 1 from duo_sharing_log where session_id = cur.id::text and institution_id = me and kind = 'purpose') then
        raise exception 'Confirm why you are sharing (314(b)) before posting in this session';
      end if;
      if not covered and not duo_is_coordination(cur.claim) and coalesce((select require_both from info_sharing where institution_id = me), false) then
        raise exception 'Your institution only shares in Duo when both sides are registered under 314(b)';
      end if;
      insert into duo_sharing_log (session_id, institution_id, kind, safe_harbor, detail)
      values (cur.id::text, me, 'message', covered, jsonb_build_object('with', coalesce(other, '')));
      perform audit_add(me, 'duo.info_shared', 'duo', cur.id::text, jsonb_build_object('with', coalesce(other, ''), 'safe_harbor', covered));
    end if;
    if r.status is distinct from cur.status then
      insert into duo_sharing_log (session_id, institution_id, kind, safe_harbor, detail)
      values (cur.id::text, me, 'status', covered, jsonb_build_object('from', cur.status, 'to', r.status));
      perform audit_add(me, 'duo.status_changed', 'duo', cur.id::text, jsonb_build_object('from', cur.status, 'to', r.status));
    end if;
  end if;

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

do $$
declare f text;
begin
  foreach f in array array['arn_find_other_side(text)','arn_invites()','arn_invite_respond(uuid,boolean)','duo_sharing_status(text)','duo_update(text,jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['case_side(jsonb)','case_amount(jsonb)','duo_is_coordination(jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
  end loop;
end $$;

-- Check
select c.relname as object, c.relrowsecurity as rls_on, null::boolean as anon_can_call
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'duo_arn_invites'
union all
select p.proname, null, has_function_privilege('anon', p.oid, 'execute')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('arn_find_other_side', 'arn_invites', 'arn_invite_respond', 'duo_sharing_status', 'duo_update');
