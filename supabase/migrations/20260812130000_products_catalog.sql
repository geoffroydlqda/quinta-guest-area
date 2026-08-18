-- Catalogue de produits (12 août 2026) : services facturables réutilisables
-- (massages, dégustations, ménage extra…) sélectionnables à la création
-- d'un paiement. TVA et prix par défaut, modifiables ligne par ligne.
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'extra' check (category in ('rental', 'catering', 'extra')),
  default_vat numeric not null default 23,
  default_price numeric,           -- € TTC, optionnel (prix libre sinon)
  unit text,                       -- 'per person', 'per night', 'per unit'…
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.products enable row level security;
drop policy if exists "Admins manage products" on public.products;
create policy "Admins manage products"
  on public.products for all to authenticated
  using (public.is_admin_email()) with check (public.is_admin_email());
revoke all on public.products from anon;

-- Lignes produits d'une échéance : [{product_id, name, qty, unit_price, vat}]
alter table public.payment_installments
  add column if not exists product_lines jsonb;
