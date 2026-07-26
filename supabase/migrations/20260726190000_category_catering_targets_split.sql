-- Distinction Rental / Catering / Extra (demande produit : dashboard + targets).
-- 1) Nouvelle catégorie 'catering' sur payment_installments.
-- 2) Reclassement des extras dont le label est manifestement du catering.
-- 3) Objectifs P&L ventilés par catégorie (rental net de remises / catering / extras),
--    sommes = CA net du P&L (2026: 140713+119964+2322 = 262999, etc.).
alter table public.payment_installments drop constraint if exists payment_installments_category_check;
alter table public.payment_installments add constraint payment_installments_category_check
  check (category = any (array['rental'::text, 'catering'::text, 'extra'::text]));

update public.payment_installments
  set category = 'catering'
  where category = 'extra'
    and (label ilike '%catering%' or label ilike '%food%');

insert into public.app_settings (key, value) values (
  'targets',
  '{
    "2026": {"net_revenue": 262999, "rental": 140713, "catering": 119964, "extras": 2322,
             "season_start": "2026-05-01", "season_end": "2026-11-01"},
    "2027": {"net_revenue": 335978, "rental": 219025, "catering": 109952, "extras": 7000,
             "season_start": "2027-05-01", "season_end": "2027-12-01"},
    "2028": {"net_revenue": 501053, "rental": 347127, "catering": 143926, "extras": 10000},
    "2029": {"net_revenue": 560592, "rental": 389994, "catering": 160598, "extras": 10000},
    "2030": {"net_revenue": 606889, "rental": 423003, "catering": 173887, "extras": 10000}
  }'
) on conflict (key) do update set value = excluded.value, updated_at = now();
