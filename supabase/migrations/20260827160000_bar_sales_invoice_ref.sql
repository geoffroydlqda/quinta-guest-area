-- 27 aout 2026 — fatura mensuelle du honesty bar (Consumidor Final) :
-- chaque vente classee est estampillee avec le document Moloni qui la couvre
-- (anti double facturation ; la fatura est generee le 1er du mois pour le
-- mois ecoule par moloni-invoice {action:'bar_month'}).
alter table public.bar_sales
  add column if not exists moloni_document_id integer,
  add column if not exists invoice_number text;
