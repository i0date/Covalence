-- =============================================================================
-- Covalence — 314(b) information sharing for Duo sessions
-- =============================================================================
-- Run once in the Supabase SQL editor, after supabase_roles_retention.sql and
-- supabase_workspace_audit.sql. Safe to re-run.
--
-- Section 314(b) of the USA PATRIOT Act (31 CFR 1010.540) gives institutions a
-- safe harbor when they share information to identify and report possible
-- money laundering or terrorist financing — but only if both are registered
-- with FinCEN (registration lasts one year) and the sharing is for that purpose.
--
-- info_sharing     one row per institution: its 314(b) registration as stated
--                  by its admin, the point of contact, and whether Duo should
--                  refuse to share when the other side isn't covered
-- duo_sharing_log  every time an institution shares in a Duo session: when,
--                  who, and whether both sides were registered at that moment
-- duo_update is replaced so each message is checked and recorded server-side.
-- =============================================================================

create table if not exists public.info_sharing (
  institution_id uuid primary key references public.institutions(id) on delete cascade,
  registered     boolean not null default false,
  expires_on     date,
  contact_name   text not null default '',
  contact_email  text not null default '',
  require_both   boolean not null default false,
  updated_at     timestamptz not null default now(),
  updated_by     uuid default auth.uid()
);
alter table public.info_sharing enable row level security;

create table if not exists public.duo_sharing_log (
  id             bigserial primary key,
  session_id     text not null,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  user_id        uuid default auth.uid(),
  kind           text not null check (kind in ('purpose','message','status')),
  safe_harbor    boolean not null,
  detail         jsonb not null default '{}'::jsonb,
  at             timestamptz not null default now()
);
create index if not exists duo_sharing_log_session on public.duo_sharing_log (session_id, institution_id, at desc);
alter table public.duo_sharing_log enable row level security;

-- Registered and not expired today
create or replace function public.sharing_valid(p_inst uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.registered and s.expires_on >= current_date from info_sharing s where s.institution_id = p_inst), false)
$$;

-- This institution's registration (any member can see it)
create or replace function public.sharing_get()
returns table (registered boolean, expires_on date, contact_name text, contact_email text, require_both boolean, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.registered, s.expires_on, s.contact_name, s.contact_email, s.require_both, s.updated_at
  from info_sharing s where s.institution_id = my_institution()
$$;

-- Admins record the registration
create or replace function public.sharing_set(p_registered boolean, p_expires_on date, p_contact_name text, p_contact_email text, p_require_both boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution();
begin
  if me is null or my_role() <> 'admin' then raise exception 'Only an institution admin can change the 314(b) registration'; end if;
  if p_registered then
    if p_expires_on is null then raise exception 'Enter the date your 314(b) registration expires'; end if;
    if p_expires_on < current_date then raise exception 'That registration has expired — renew it with FinCEN first'; end if;
    if p_expires_on > current_date + 400 then raise exception 'A 314(b) registration lasts one year — check the expiry date'; end if;
    if trim(coalesce(p_contact_name, '')) = '' or trim(coalesce(p_contact_email, '')) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'Enter the point of contact named in the registration, with an email address';
    end if;
  end if;
  insert into info_sharing (institution_id, registered, expires_on, contact_name, contact_email, require_both)
  values (me, coalesce(p_registered, false), case when p_registered then p_expires_on end,
          left(trim(coalesce(p_contact_name, '')), 200), left(trim(coalesce(p_contact_email, '')), 200), coalesce(p_require_both, false))
  on conflict (institution_id) do update set
    registered = excluded.registered, expires_on = excluded.expires_on, contact_name = excluded.contact_name,
    contact_email = excluded.contact_email, require_both = excluded.require_both, updated_at = now(), updated_by = auth.uid();
  perform audit_add(me, 'sharing.updated', 'workspace', '314b',
    jsonb_build_object('registered', coalesce(p_registered, false), 'expires_on', p_expires_on, 'contact', trim(coalesce(p_contact_email, '')), 'require_both', coalesce(p_require_both, false)));
end $$;

-- Both sides' registration, this side's purpose confirmation and sharing record.
-- Only the session's two institutions see it.
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
    'require_both', coalesce((select require_both from info_sharing where institution_id = me), false),
    'purpose', (select jsonb_build_object('at', l.at, 'by', coalesce(m.display_name, m.email, ''), 'text', l.detail->>'purpose')
                from duo_sharing_log l left join memberships m on m.user_id = l.user_id and m.institution_id = me
                where l.session_id = s.id::text and l.institution_id = me and l.kind = 'purpose' order by l.at desc limit 1),
    'log', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'at', l.at, 'safe_harbor', l.safe_harbor, 'by', coalesce(m.display_name, m.email, ''), 'detail', l.detail) order by l.at desc)
                     from (select * from duo_sharing_log where session_id = s.id::text and institution_id = me order by at desc limit 100) l
                     left join memberships m on m.user_id = l.user_id and m.institution_id = me), '[]'::jsonb));
end $$;

-- The analyst confirms, once per session, why their institution is sharing
create or replace function public.duo_share_confirm(p_id text, p_purpose text)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); s duo_sessions; covered boolean;
begin
  perform need_write();
  select * into s from duo_sessions where id::text = upper(p_id);
  if not found or me is null or (me is distinct from s.institution_a_id and me is distinct from s.institution_b_id) then raise exception 'Your institution is not part of this Duo session'; end if;
  if trim(coalesce(p_purpose, '')) = '' then raise exception 'Say why you are sharing'; end if;
  covered := s.institution_b_id is not null and sharing_valid(s.institution_a_id) and sharing_valid(s.institution_b_id);
  insert into duo_sharing_log (session_id, institution_id, kind, safe_harbor, detail)
  values (s.id::text, me, 'purpose', covered, jsonb_build_object('purpose', left(trim(p_purpose), 500)));
  perform audit_add(me, 'duo.sharing_purpose', 'duo', s.id::text, jsonb_build_object('purpose', left(trim(p_purpose), 500), 'safe_harbor', covered));
end $$;

-- duo_update (from supabase_roles_retention.sql), now checking and recording
-- each message this institution adds, and recording status changes in the
-- sharing record
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
      if not covered and coalesce((select require_both from info_sharing where institution_id = me), false) then
        raise exception 'Your institution only shares in Duo when both sides are registered under 314(b)';
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
  foreach f in array array['sharing_get()','sharing_set(boolean,date,text,text,boolean)','duo_sharing_status(text)',
                           'duo_share_confirm(text,text)','duo_update(text,jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public.sharing_valid(uuid) from public, anon, authenticated';
end $$;

-- Check
select c.relname as object, c.relrowsecurity as rls_on, null::boolean as anon_can_call
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('info_sharing', 'duo_sharing_log')
union all
select p.proname, null, has_function_privilege('anon', p.oid, 'execute')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('sharing_valid', 'sharing_get', 'sharing_set', 'duo_sharing_status', 'duo_share_confirm', 'duo_update');
