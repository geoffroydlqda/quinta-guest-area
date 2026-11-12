-- Onglet Operations > Inventory (12 nov 2026, demande Geoffroy).
-- Systeme PAR-stock simplifie (hospitalite) : references approuvees (une
-- reference exacte par besoin), niveau cible (par) + seuil de commande
-- (reorder_point), comptage guide la VEILLE de chaque evenement (jour tampon
-- sans client), shopping list automatique. Perimetre de depart : Housekeeping.
-- Les references exactes sont laissees vides : Geoffroy les complete dans l'UI.

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Reference approuvee exacte : marque + produit + conditionnement.
  reference text,
  supplier text,
  category text not null default 'Housekeeping',
  location text not null default 'Storage',
  -- Unite comptee (ex. "pack of 24 rolls", "bottle 1.5 L").
  unit text,
  par numeric not null default 1 check (par > 0),
  reorder_point numeric not null default 0 check (reorder_point >= 0),
  current_qty numeric,
  last_counted_at timestamptz,
  last_counted_by text,
  notes text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Historique des comptages (un comptage = un passage de Luis).
create table public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  counted_by text,
  -- Booking dont l'arrivee a declenche le comptage (J-1), si applicable.
  booking_id uuid references public.bookings(id) on delete set null,
  note text
);

create table public.inventory_count_lines (
  count_id uuid not null references public.inventory_counts(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  qty numeric not null,
  primary key (count_id, item_id)
);

alter table public.inventory_items enable row level security;
alter table public.inventory_counts enable row level security;
alter table public.inventory_count_lines enable row level security;
revoke all on public.inventory_items from anon, authenticated;
revoke all on public.inventory_counts from anon, authenticated;
revoke all on public.inventory_count_lines from anon, authenticated;
grant select, insert, update, delete on public.inventory_items to authenticated;
grant select, insert, update, delete on public.inventory_counts to authenticated;
grant select, insert, update, delete on public.inventory_count_lines to authenticated;

create policy inventory_items_admin on public.inventory_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy inventory_counts_admin on public.inventory_counts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy inventory_count_lines_admin on public.inventory_count_lines
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Liste de depart Housekeeping (references vides, a completer par Geoffroy).
insert into public.inventory_items (name, category, location, unit, par, reorder_point, sort_order) values
  ('Toilet paper',              'Housekeeping', 'Laundry room',      'pack',        6, 3, 10),
  ('Paper towels',              'Housekeeping', 'Laundry room',      'pack',        4, 2, 20),
  ('Laundry detergent',         'Housekeeping', 'Laundry room',      'bottle/box',  2, 1, 30),
  ('Fabric softener',           'Housekeeping', 'Laundry room',      'bottle',      2, 1, 40),
  ('Dishwasher tablets',        'Housekeeping', 'Laundry room',      'box',         2, 1, 50),
  ('Dish soap',                 'Housekeeping', 'Cleaning cupboard', 'bottle',      2, 1, 60),
  ('Multi-surface cleaner',     'Housekeeping', 'Cleaning cupboard', 'bottle',      2, 1, 70),
  ('Bathroom cleaner (limescale)','Housekeeping','Cleaning cupboard','bottle',      2, 1, 80),
  ('Floor cleaner',             'Housekeeping', 'Cleaning cupboard', 'bottle',      2, 1, 90),
  ('Glass cleaner',             'Housekeeping', 'Cleaning cupboard', 'bottle',      2, 1, 100),
  ('Bleach (lixivia)',          'Housekeeping', 'Cleaning cupboard', 'bottle',      2, 1, 110),
  ('WC gel / blocks',           'Housekeeping', 'Cleaning cupboard', 'unit',        4, 2, 120),
  ('Sponges',                   'Housekeeping', 'Cleaning cupboard', 'pack',        2, 1, 130),
  ('Microfiber cloths',         'Housekeeping', 'Cleaning cupboard', 'pack',        2, 1, 140),
  ('Rubber gloves',             'Housekeeping', 'Cleaning cupboard', 'pair',        2, 1, 150),
  ('Trash bags 30 L',           'Housekeeping', 'Cleaning cupboard', 'roll',        4, 2, 160),
  ('Trash bags 100 L',          'Housekeeping', 'Cleaning cupboard', 'roll',        4, 2, 170),
  ('Hand soap refill',          'Housekeeping', 'Bathrooms storage', 'bottle',      4, 2, 180),
  ('Shampoo',                   'Housekeeping', 'Bathrooms storage', 'bottle',      6, 3, 190),
  ('Shower gel',                'Housekeeping', 'Bathrooms storage', 'bottle',      6, 3, 200),
  ('Tissues',                   'Housekeeping', 'Bathrooms storage', 'box',         6, 3, 210);
