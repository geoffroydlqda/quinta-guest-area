-- Fiches guests : société + adresse structurée (street / zip / city / country),
-- nécessaires pour la facturation Moloni. L'ancien champ address devient la rue.
alter table public.client_profiles
  add column if not exists company_name text,
  add column if not exists zip_code text,
  add column if not exists city text,
  add column if not exists country text;
