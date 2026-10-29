-- =============================================================================
-- Covalence — Sound the alarm: one shared signal when a fraud wave or attack starts
-- =============================================================================
-- Run once in the Supabase SQL editor, after supabase_roles_retention.sql and
-- supabase_workspace_audit.sql. Safe to re-run.
--
-- Three levels, each saying what it means so nobody guesses:
--   1 Watch     something looks off            — anyone can raise
--   2 Alert     confirmed pattern, losses       — anyone can raise; Slack (api/alarm.js)
--               possible                          and a Trio incident
--   3 Critical  active attack, real losses      — admins and reviewers, or an analyst
--                                                  who confirms; everyone is told
-- An institution has at most one open alarm: raising another joins it (and
-- raises its level if higher), so a wave reported by five people is one alarm.
-- Every alarm names an owner, what to do now and when the next update is due,
-- and ends with a stand-down. Every step is audited.
-- =============================================================================

create table if not exists public.alarms (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  level          int not null check (level between 1 and 3),
  title          text not null,
  do_now         text not null default '',
  owner_name     text not null default '',
  owner_email    text not null default '',
  raised_by      uuid default auth.uid(),
  raised_at      timestamptz not null default now(),
  next_update_at timestamptz,
  incident_id    text not null default '',
  reports        jsonb not null default '[]'::jsonb,   -- everyone who raised or joined it
  status         text not null default 'open' check (status in ('open', 'stood_down')),
  stood_down_at  timestamptz,
  stood_down_by  text not null default '',
  stand_down_note text not null default '',
  updated_at     timestamptz not null default now()
);
create unique index if not exists alarms_one_open on public.alarms (institution_id) where status = 'open';
alter table public.alarms enable row level security;

create or replace function public.alarm_me()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', coalesce(nullif(m.display_name, ''), m.email), 'email', m.email, 'role', m.role)
  from memberships m where m.user_id = auth.uid() and m.institution_id = my_institution() limit 1
$$;

-- The open alarm, if any, and the last few stood down
create or replace function public.alarm_list()
returns setof public.alarms
language sql stable security definer set search_path = public as $$
  (select * from alarms where institution_id = my_institution() and status = 'open')
  union all
  (select * from alarms where institution_id = my_institution() and status = 'stood_down' order by stood_down_at desc limit 10)
$$;

-- Raise an alarm, or join the one already open
create or replace function public.alarm_raise(p_level int, p_title text, p_do_now text, p_next_minutes int, p_confirmed boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); who jsonb := alarm_me(); cur alarms; lvl int := least(3, greatest(1, coalesce(p_level, 1)));
begin
  perform need_write();
  if trim(coalesce(p_title, '')) = '' then raise exception 'Say what’s happening in a few words'; end if;
  if lvl = 3 and not can_configure() and not coalesce(p_confirmed, false) then
    raise exception 'Confirm that this is an active attack with real losses to raise a critical alarm';
  end if;
  select * into cur from alarms where institution_id = me and status = 'open' for update;
  if found then
    update alarms set level = greatest(level, lvl), updated_at = now(),
      reports = reports || jsonb_build_array(jsonb_build_object('by', who->>'name', 'email', who->>'email', 'at', now(), 'level', lvl, 'note', left(trim(p_title), 200)))
    where id = cur.id returning * into cur;
    perform audit_add(me, 'alarm.joined', 'alarm', cur.id::text, jsonb_build_object('level', lvl, 'note', left(trim(p_title), 200)));
    return jsonb_build_object('id', cur.id, 'joined', true, 'level', cur.level);
  end if;
  insert into alarms (institution_id, level, title, do_now, owner_name, owner_email, next_update_at, reports)
  values (me, lvl, left(trim(p_title), 200), left(trim(coalesce(p_do_now, '')), 500), coalesce(who->>'name', ''), coalesce(who->>'email', ''),
          now() + make_interval(mins => least(480, greatest(5, coalesce(p_next_minutes, 30)))),
          jsonb_build_array(jsonb_build_object('by', who->>'name', 'email', who->>'email', 'at', now(), 'level', lvl, 'note', 'Raised')))
  returning * into cur;
  perform audit_add(me, 'alarm.raised', 'alarm', cur.id::text, jsonb_build_object('level', lvl, 'title', cur.title));
  return jsonb_build_object('id', cur.id, 'joined', false, 'level', cur.level);
end $$;

-- Change the level, post an update (owner, what to do, next update), link the
-- Trio incident, or stand it down
create or replace function public.alarm_update(p_id uuid, p_action text, p_level int default null, p_do_now text default null,
                                               p_next_minutes int default null, p_owner_email text default null, p_incident_id text default null,
                                               p_note text default '', p_confirmed boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); who jsonb := alarm_me(); cur alarms; o memberships;
begin
  perform need_write();
  select * into cur from alarms where id = p_id and institution_id = me and status = 'open' for update;
  if not found then raise exception 'That alarm isn’t open'; end if;
  if p_action = 'level' then
    if p_level not between 1 and 3 then raise exception 'Levels are 1 to 3'; end if;
    if p_level = 3 and not can_configure() and not coalesce(p_confirmed, false) then
      raise exception 'Confirm that this is an active attack with real losses to raise a critical alarm';
    end if;
    update alarms set level = p_level, updated_at = now() where id = cur.id;
    perform audit_add(me, 'alarm.level_changed', 'alarm', cur.id::text, jsonb_build_object('from', cur.level, 'to', p_level, 'note', left(coalesce(p_note, ''), 200)));
  elsif p_action = 'update' then
    if p_owner_email is not null and p_owner_email <> '' then
      select * into o from memberships where institution_id = me and lower(email) = lower(p_owner_email);
      if not found then raise exception 'The owner has to be someone on your team'; end if;
    end if;
    update alarms set
      do_now = coalesce(left(trim(p_do_now), 500), do_now),
      next_update_at = case when p_next_minutes is null then next_update_at else now() + make_interval(mins => least(480, greatest(5, p_next_minutes))) end,
      owner_name = case when o.user_id is null then owner_name else coalesce(nullif(o.display_name, ''), o.email) end,
      owner_email = case when o.user_id is null then owner_email else o.email end,
      updated_at = now()
    where id = cur.id;
    perform audit_add(me, 'alarm.updated', 'alarm', cur.id::text, jsonb_build_object('do_now', p_do_now, 'next_minutes', p_next_minutes, 'owner', p_owner_email));
  elsif p_action = 'incident' then
    update alarms set incident_id = left(coalesce(p_incident_id, ''), 60), updated_at = now() where id = cur.id;
  elsif p_action = 'stand_down' then
    update alarms set status = 'stood_down', stood_down_at = now(), stood_down_by = coalesce(who->>'name', ''), stand_down_note = left(trim(coalesce(p_note, '')), 500), updated_at = now()
    where id = cur.id;
    perform audit_add(me, 'alarm.stood_down', 'alarm', cur.id::text, jsonb_build_object('note', left(trim(coalesce(p_note, '')), 500), 'level', cur.level));
  else
    raise exception 'Unknown step';
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['alarm_list()','alarm_raise(int,text,text,int,boolean)','alarm_update(uuid,text,int,text,int,text,text,text,boolean)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public.alarm_me() from public, anon, authenticated';
end $$;

-- Check
select c.relname as object, c.relrowsecurity as rls_on, null::boolean as anon_can_call
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'alarms'
union all
select p.proname, null, has_function_privilege('anon', p.oid, 'execute')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('alarm_me', 'alarm_list', 'alarm_raise', 'alarm_update');
