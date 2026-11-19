-- Multi-lieux P3 (19 nov 2026) : chambres par lieu gérées depuis l'admin.
-- La Quinta garde ses 11 chambres codées en dur dans l'app (plan dessiné,
-- photos, paires de salles de bain) — cette table porte les lieux SANS plan
-- (Terra da Paz aujourd'hui), gérés en liste. Gestion : onglet Housekeeping,
-- switcher sur TDP. Servira aussi à la guest area Terra (P4 — une policy de
-- lecture guest sera ajoutée à ce moment-là).
create table if not exists public.property_rooms (
  id uuid primary key default gen_random_uuid(),
  property text not null check (property in ('quinta','terra')),
  name text not null,
  bed_type text, -- libre : King / Queen / Twins / Bunk beds / Dorm…
  capacity integer not null default 2 check (capacity between 1 and 20),
  bathroom text not null default 'shared' check (bathroom in ('en-suite','shared')),
  note text, -- étage, vue, particularités…
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.property_rooms enable row level security;
drop policy if exists "property_rooms admin all" on public.property_rooms;
create policy "property_rooms admin all" on public.property_rooms
  for all using (public.is_admin()) with check (public.is_admin());

create index if not exists property_rooms_property_idx
  on public.property_rooms (property, sort_order);
