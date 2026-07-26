-- Objectifs annuels (P&L) + saison d'exploitation, pour le dashboard admin.
-- Source : Financial Model Quinta do Amor (CA net, hors TVA), colonnes 2026-2030.
-- Saisons : 2026 = 1er mai -> 1er nov ; 2027 = 1er mai -> 1er dec (fin exclusive).
-- Modifiable ensuite via app_settings (RLS admin, key <> 'internal').
insert into public.app_settings (key, value) values (
  'targets',
  '{
    "2026": {"net_revenue": 262999, "season_start": "2026-05-01", "season_end": "2026-11-01"},
    "2027": {"net_revenue": 335978, "season_start": "2027-05-01", "season_end": "2027-12-01"},
    "2028": {"net_revenue": 501053},
    "2029": {"net_revenue": 560592},
    "2030": {"net_revenue": 606889}
  }'
) on conflict (key) do nothing;
