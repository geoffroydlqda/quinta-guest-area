-- Phase 0 : centralisation des admins et des tarifs
-- 1) Table admin_users = source de vérité unique des emails admin
-- 2) is_admin() / is_admin_email() lisent la table (RLS inchangées)
-- 3) Table pricing_settings = source de vérité unique des tarifs (taxi, food)

-- ---------------------------------------------------------------------------
-- admin_users
-- ---------------------------------------------------------------------------
create table if not exists public.admin_users (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
-- Aucune policy : la table n'est lisible que par le service role et les
-- fonctions SECURITY DEFINER ci-dessous. Les clients n'y accèdent jamais.

insert into public.admin_users (email) values
  ('hello@quintamor.com'),
  ('loïs@quintamor.com'),
  ('lois@quintamor.com'),
  ('977luisferreira@gmail.com')
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- Fonctions admin : mêmes signatures qu'avant (les policies RLS et le trigger
-- prevent_booking_sensitive_update continuent de fonctionner sans modification)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin_email() returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.admin_users a
    where a.email = lower(trim(coalesce((auth.jwt() ->> 'email'), '')))
  );
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select public.is_admin_email();
$$;

-- Helper pour les Edge Functions (vérification d'un email arbitraire)
create or replace function public.check_is_admin_email(check_email text) returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.admin_users a
    where a.email = lower(trim(coalesce(check_email, '')))
  );
$$;

-- ---------------------------------------------------------------------------
-- pricing_settings
-- ---------------------------------------------------------------------------
create table if not exists public.pricing_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.pricing_settings enable row level security;

drop policy if exists "Authenticated users read pricing" on public.pricing_settings;
create policy "Authenticated users read pricing"
  on public.pricing_settings for select
  to authenticated
  using (true);

drop policy if exists "Admins manage pricing" on public.pricing_settings;
create policy "Admins manage pricing"
  on public.pricing_settings for all
  to authenticated
  using (public.is_admin_email())
  with check (public.is_admin_email());

-- Seed : tarifs taxi mis à jour (70/90/110, juillet 2026) + tarifs food actuels
insert into public.pricing_settings (key, value) values
  ('taxi', '{"seats4": 70, "seats6": 90, "seats8": 110}'),
  ('food', '{
    "vegetarian":        {"fullBoard": 70, "breakfast": 20, "lunch": 23, "dinner": 27},
    "meat_dinner":       {"fullBoard": 78, "breakfast": 20, "lunch": 23, "dinner": 35},
    "meat_lunch_dinner": {"fullBoard": 85, "breakfast": 20, "lunch": 30, "dinner": 35}
  }')
on conflict (key) do update set value = excluded.value, updated_at = now();
