-- =============================================================================
-- Covalence — The hosted claim form (api/claims.js → /claim/<token>)
-- =============================================================================
-- Run once in the Supabase SQL editor, after supabase_claims.sql and
-- supabase_roles_retention.sql. Safe to re-run. It also lets claims come from merchants' customers.
--
-- For banks without developers: Covalence hosts the claim form. A customer who sees
-- something wrong taps "Report a problem" in the bank's app or on its website; the
-- bank's systems ask api/claims.js for a link for that customer and the payments
-- from its records, and open it. The customer says what went wrong, whether they
-- recognise each payment, what they need now (lock the card, …), answers the
-- questions, and sends the claim, like a claim from the bank's own app.
-- Covalence never sends these links to customers.
--   • A link is a random token; only its SHA-256 hash is stored here
--   • It works once, and only until it expires (72 hours unless the bank says otherwise, at most 7 days)
--   • Links are made and used only through api/claims.js, with the service role
--   • claim_form holds the bank's name, logo and phone number on the form
-- =============================================================================

-- Claims for every side: a bank or credit union (fi), a crypto exchange (ce), and now a
-- merchant's own customers (mx), each on its own side of Triage → Claims
alter table public.app_claims drop constraint if exists app_claims_segment_check;
alter table public.app_claims add constraint app_claims_segment_check check (segment in ('fi', 'ce', 'mx'));

create table if not exists public.claim_form (
  institution_id uuid primary key references public.institutions(id) on delete cascade,
  display_name   text not null default '' check (length(display_name) <= 120),
  logo_url       text not null default '' check (logo_url = '' or (logo_url ~ '^https://' and length(logo_url) <= 500)),
  support_phone  text not null default '' check (length(support_phone) <= 40),
  help_url       text not null default '' check (help_url = '' or (help_url ~ '^https://' and length(help_url) <= 500)),
  updated_at     timestamptz not null default now(),
  updated_by     text not null default ''
);
alter table public.claim_form enable row level security;

create table if not exists public.claim_links (
  id             text primary key,                    -- LNK-…, shown to analysts
  token_hash     text not null unique,                -- SHA-256 of the token in the link
  institution_id uuid not null references public.institutions(id) on delete cascade,
  reference      text not null default '',            -- the bank's own reference, if it gave one
  segment        text not null default 'fi' check (segment in ('fi', 'ce', 'mx')),   -- a bank, an exchange, a merchant
  customer       jsonb not null,                      -- { id, name, email, phone, accountType, accountOpened }
  transactions   jsonb not null,                      -- as in a claim (src/claims.mjs normaliseClaim)
  created_by     text not null default '',
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  opened_at      timestamptz,
  used_at        timestamptz,
  claim_id       text not null default '',
  revoked_at     timestamptz
);
create index if not exists claim_links_inst_idx on public.claim_links (institution_id, created_at desc);
alter table public.claim_links enable row level security;

-- What the customer sees, for Settings → Claim form
create or replace function public.claim_form_get()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select to_jsonb(f) - 'institution_id' from claim_form f where f.institution_id = my_institution()), '{}'::jsonb)
    || jsonb_build_object('institution', (select name from institutions where id = my_institution()))
$$;

create or replace function public.claim_form_set(p_display_name text, p_logo_url text, p_support_phone text, p_help_url text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := my_institution(); who text;
begin
  if me is null then raise exception 'Sign in and join an institution first'; end if;
  if not can_configure() then raise exception 'Only admins and reviewers can change the claim form'; end if;
  select coalesce(nullif(m.display_name, ''), m.email) into who from memberships m where m.user_id = auth.uid() limit 1;
  insert into claim_form (institution_id, display_name, logo_url, support_phone, help_url, updated_at, updated_by)
  values (me, left(trim(coalesce(p_display_name, '')), 120), trim(coalesce(p_logo_url, '')),
          left(trim(coalesce(p_support_phone, '')), 40), trim(coalesce(p_help_url, '')), now(), coalesce(who, ''))
  on conflict (institution_id) do update set display_name = excluded.display_name, logo_url = excluded.logo_url,
    support_phone = excluded.support_phone, help_url = excluded.help_url, updated_at = now(), updated_by = excluded.updated_by;
  perform audit_add(me, 'claim.form_changed', 'claim', 'form', jsonb_build_object('name', left(trim(coalesce(p_display_name, '')), 120)));
  return claim_form_get();
end $$;

revoke all on function public.claim_form_get() from public, anon;
revoke all on function public.claim_form_set(text, text, text, text) from public, anon;
grant execute on function public.claim_form_get() to authenticated;
grant execute on function public.claim_form_set(text, text, text, text) to authenticated;
