-- Ventes bar non décomposables en produits (tests de carte 0,01/0,10 €,
-- pourboires, montants hors grille) : comptées comme "divers 23 %" —
-- décision Geoffroy 1er sept 2026 (exhaustivité comptable plutôt qu'ignorer).
alter table public.bar_sales add column if not exists misc_amount numeric not null default 0;
comment on column public.bar_sales.misc_amount is 'Part non decomposable en produits (tests de carte, pourboires, montants hors grille) — facturee en ligne divers 23% sur la fatura mensuelle.';
