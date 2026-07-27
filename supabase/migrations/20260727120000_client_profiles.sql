-- Fiches clients (onglet admin "Guests", juillet 2026).
-- Un client = une adresse email (clé de regroupement des bookings), avec les
-- coordonnées de facturation / contact : téléphone, numéro fiscal, adresse,
-- nationalité. Distinct de guest_profiles (profil de compte côté guest area).
create table if not exists public.client_profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  first_name text,
  last_name text,
  phone text,
  tax_number text,
  address text,
  nationality text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_profiles enable row level security;

-- Admin uniquement (lecture + écriture) : données de facturation.
create policy "Admins can read client profiles"
  on public.client_profiles for select
  using (public.is_admin());

create policy "Admins can insert client profiles"
  on public.client_profiles for insert
  with check (public.is_admin());

create policy "Admins can update client profiles"
  on public.client_profiles for update
  using (public.is_admin());

create policy "Admins can delete client profiles"
  on public.client_profiles for delete
  using (public.is_admin());

-- updated_at automatique
create or replace function public.touch_client_profiles()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_client_profiles_touch on public.client_profiles;
create trigger trg_client_profiles_touch
  before update on public.client_profiles
  for each row execute function public.touch_client_profiles();

-- Pré-remplissage depuis les bookings existants (nom/prénom du booking le plus récent)
insert into public.client_profiles (email, first_name, last_name)
select distinct on (lower(email))
  lower(email), first_name, last_name
from public.bookings
where email is not null and email <> ''
order by lower(email), created_at desc
on conflict (email) do nothing;
