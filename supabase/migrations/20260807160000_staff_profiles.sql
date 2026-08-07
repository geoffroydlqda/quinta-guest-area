-- Onglet Staff (7 août 2026) — profils de l'équipe, accès admin, onglets autorisés.
-- staff_profiles est la fiche annuaire (nom, rôle, contact) ; l'accès admin
-- reste gouverné par admin_users (source de vérité, gérée via l'Edge Function
-- admin-staff-access) ; allowed_tabs restreint les onglets VISIBLES de
-- l'espace admin (null = tous). NB : c'est un contrôle d'interface — les
-- policies RLS restent au niveau "admin ou pas".
create table if not exists public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique,                -- requis pour donner un accès admin
  phone text,
  role text,                        -- Chef, Service, Management, Logistics…
  team text,                        -- kitchen | housekeeping | management | transport | other
  allowed_tabs text[],              -- null = tous les onglets
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.staff_profiles enable row level security;
drop policy if exists "staff_profiles admin all" on public.staff_profiles;
create policy "staff_profiles admin all" on public.staff_profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- Seed : admins actuels + équipe cuisine (event_staff)
insert into public.staff_profiles (name, email, role, team) values
  ('Geoffroy', 'hello@quintamor.com', 'Owner / Management', 'management'),
  ('Loïs', 'lois@quintamor.com', 'Management', 'management'),
  ('Luis', '977luisferreira@gmail.com', 'Logistics', 'transport'),
  ('Thomas', 'thomasquerton@gmail.com', 'Catering manager', 'kitchen'),
  ('Olivier', 'olivier@purrpose.co', 'Advisor', 'other'),
  ('Jack', null, 'Chef', 'kitchen'),
  ('Jake', null, 'Chef', 'kitchen'),
  ('Bella', null, 'Service', 'kitchen'),
  ('Celestine', null, 'Service', 'kitchen')
on conflict (email) do nothing;
