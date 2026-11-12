-- =============================================================================
-- Covalence — Switching tools and features on and off (Settings → Your setup)
-- =============================================================================
-- Run once in the Supabase SQL editor, after supabase_roles_retention.sql and
-- supabase_workspace_audit.sql. Safe to re-run.
--
-- The institution's settings (workspace_kv, key cov_settings) carry two lists:
--   • sides: what the workspace does (issuer, acquirer, merchant)
--   • off:   the tools and features switched off (src/features.mjs)
-- Admins and reviewers can change the other settings as before; only admins can
-- change these two, and every change goes into the audit log with before and after.
-- Switching something off never deletes its data.
-- =============================================================================

create or replace function public.kv_put(p_key text, p_value text)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); v_at timestamptz := clock_timestamp(); v_old text; o jsonb; n jsonb;
begin
  perform need_write();
  if p_key in ('cov_settings', 'cov_autobatch_3pm') and not can_configure() then
    raise exception 'Only admins and reviewers can change institution settings';
  end if;
  if length(p_value) > 2000000 then raise exception 'Value too large'; end if;
  if p_key = 'cov_settings' then
    select value into v_old from workspace_kv where institution_id = me and key = p_key;
    begin o := coalesce(v_old, '{}')::jsonb; exception when others then o := '{}'::jsonb; end;
    begin n := p_value::jsonb; exception when others then raise exception 'Settings must be JSON'; end;
    if coalesce(o->'off', '[]'::jsonb) is distinct from coalesce(n->'off', '[]'::jsonb)
       or coalesce(o->'sides', '[]'::jsonb) is distinct from coalesce(n->'sides', '[]'::jsonb) then
      if coalesce(my_role(), '') <> 'admin' then
        raise exception 'Only admins can switch tools and features on or off, or change what you do';
      end if;
      perform audit_add(me, 'settings.switched', 'settings', 'cov_settings', jsonb_build_object(
        'off',   jsonb_build_object('from', coalesce(o->'off', '[]'::jsonb),   'to', coalesce(n->'off', '[]'::jsonb)),
        'sides', jsonb_build_object('from', coalesce(o->'sides', '[]'::jsonb), 'to', coalesce(n->'sides', '[]'::jsonb))));
    end if;
  end if;
  insert into workspace_kv (institution_id, key, value, updated_at, updated_by)
  values (me, p_key, p_value, v_at, auth.uid())
  on conflict (institution_id, key) do update
    set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    where workspace_kv.value is distinct from excluded.value;
  return v_at;
end $$;

-- Clearing the settings would switch everything back on: admins only
create or replace function public.kv_delete(p_key text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform need_write();
  if p_key in ('cov_settings', 'cov_autobatch_3pm') and not can_configure() then
    raise exception 'Only admins and reviewers can change institution settings';
  end if;
  if p_key = 'cov_settings' and coalesce(my_role(), '') <> 'admin' then
    raise exception 'Only admins can reset the institution settings';
  end if;
  if p_key = 'cov_settings' then
    perform audit_add(my_institution(), 'settings.reset', 'settings', 'cov_settings', '{}'::jsonb);
  end if;
  delete from workspace_kv where institution_id = my_institution() and key = p_key;
end $$;
