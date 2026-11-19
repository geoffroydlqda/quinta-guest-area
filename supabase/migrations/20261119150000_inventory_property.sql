-- Multi-lieux P3 (19 nov 2026) : inventaire par lieu. Chaque référence vit à
-- la Quinta, à Terra, ou est 'shared' (matos qui circule entre les deux lieux
-- — visible dans les deux vues). L'existant reste 'quinta' (défaut).
alter table public.inventory_items
  add column if not exists property text not null default 'quinta';
alter table public.inventory_items
  drop constraint if exists inventory_items_property_check;
alter table public.inventory_items
  add constraint inventory_items_property_check check (property in ('quinta','terra','shared'));
create index if not exists inventory_items_property_idx on public.inventory_items (property);
