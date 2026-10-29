-- =============================================================================
-- Covalence — what a Duo session is for: recovery by default, 314(b) by choice
-- =============================================================================
-- Run once in the Supabase SQL editor, after supabase_arn_sync.sql. Safe to re-run.
--
-- Most Duo sessions recover funds or stop fraud — recalling a payment, freezing
-- a scam beneficiary. Institutions share what that needs every day; 314(b) is
-- a safe harbor for sharing about suspected money laundering or terrorist
-- financing, not a condition of talking to each other. So a session's purpose
-- has a kind:
--   recovery  recover funds or stop fraud (the default, recorded on the first post)
--   dispute   resolve a chargeback (the default for sessions linked by ARN)
--   aml       investigate possible money laundering or terrorist financing — the
--             314(b) panel and the "only when both sides are registered" rule apply
-- Nothing blocks a post except that rule, in an aml session. Purposes recorded
-- before this file have no kind and count as aml (they were 314(b) purposes).
-- =============================================================================

drop function if exists public.duo_share_confirm(text, text);

create or replace function public.duo_share_confirm(p_id text, p_purpose text, p_kind text)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); s duo_sessions; covered boolean;
begin
  perform need_write();
  if p_kind not in ('recovery', 'aml', 'dispute') then raise exception 'Pick what the session is for'; end if;
  select * into s from duo_sessions where id::text = upper(p_id);
  if not found or me is null or (me is distinct from s.institution_a_id and me is distinct from s.institution_b_id) then raise exception 'Your institution is not part of this Duo session'; end if;
  if trim(coalesce(p_purpose, '')) = '' then raise exception 'Say why you are sharing'; end if;
  covered := s.institution_b_id is not null and sharing_valid(s.institution_a_id) and sharing_valid(s.institution_b_id);
  insert into duo_sharing_log (session_id, institution_id, kind, safe_harbor, detail)
  values (s.id::text, me, 'purpose', covered, jsonb_build_object('kind', p_kind, 'purpose', left(trim(p_purpose), 500)));
  perform audit_add(me, 'duo.sharing_purpose', 'duo', s.id::text, jsonb_build_object('kind', p_kind, 'purpose', left(trim(p_purpose), 500), 'safe_harbor', covered));
end $$;

-- From supabase_arn.sql, now returning the purpose's kind
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
    'purpose', (select jsonb_build_object('at', l.at, 'by', coalesce(m.display_name, m.email, ''), 'text', l.detail->>'purpose', 'kind', coalesce(l.detail->>'kind', 'aml'), 'auto', coalesce((l.detail->>'auto')::boolean, false))
                from duo_sharing_log l left join memberships m on m.user_id = l.user_id and m.institution_id = me
                where l.session_id = s.id::text and l.institution_id = me and l.kind = 'purpose' order by l.at desc, l.id desc limit 1),
    'log', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'at', l.at, 'safe_harbor', l.safe_harbor, 'by', coalesce(m.display_name, m.email, ''), 'detail', l.detail) order by l.at desc)
                     from (select * from duo_sharing_log where session_id = s.id::text and institution_id = me order by at desc limit 100) l
                     left join memberships m on m.user_id = l.user_id and m.institution_id = me), '[]'::jsonb));
end $$;

-- From supabase_arn.sql: no purpose step before posting; require-both only for aml
create or replace function public.duo_update(p_id text, p jsonb)
returns setof public.duo_sessions
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); cur duo_sessions; r duo_sessions; legacy boolean; side text; shared boolean; covered boolean; other text; purpose text;
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
      purpose := (select coalesce(detail->>'kind', 'aml') from duo_sharing_log where session_id = cur.id::text and institution_id = me and kind = 'purpose' order by at desc, id desc limit 1);
      if purpose is null then   -- nobody said otherwise: recovering funds, or resolving the chargeback
        purpose := case when duo_is_coordination(cur.claim) then 'dispute' else 'recovery' end;
        insert into duo_sharing_log (session_id, institution_id, kind, safe_harbor, detail)
        values (cur.id::text, me, 'purpose', covered, jsonb_build_object('kind', purpose, 'auto', true,
          'purpose', case purpose when 'dispute' then 'Resolve this chargeback' else 'Recover funds or stop fraud' end));
      end if;
      if purpose = 'aml' and not covered and coalesce((select require_both from info_sharing where institution_id = me), false) then
        raise exception 'Your institution only shares money-laundering information in Duo when both sides are registered under 314(b)';
      end if;
      insert into duo_sharing_log (session_id, institution_id, kind, safe_harbor, detail)
      values (cur.id::text, me, 'message', covered, jsonb_build_object('with', coalesce(other, '')));
      perform audit_add(me, 'duo.info_shared', 'duo', cur.id::text, jsonb_build_object('with', coalesce(other, ''), 'safe_harbor', covered));
    end if;
    if r.status is distinct from cur.status then
      insert into duo_sharing_log (session_id, institution_id, kind, safe_harbor, detail)
      values (cur.id::text, me, 'status', covered, jsonb_build_object('from', cur.status, 'to', r.status));
      -- the audit entry itself comes from the audit_duo trigger (supabase_workspace_audit.sql)
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
  foreach f in array array['duo_share_confirm(text,text,text)','duo_sharing_status(text)','duo_update(text,jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Check
select p.proname, pg_get_function_identity_arguments(p.oid) as args, has_function_privilege('anon', p.oid, 'execute') as anon_can_call
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('duo_share_confirm', 'duo_sharing_status', 'duo_update');
