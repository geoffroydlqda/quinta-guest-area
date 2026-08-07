-- Mois P&L forcé (7 août 2026) — équivalent de la colonne "OVERWRITE MONTH"
-- de l'ancien Google Sheet. Cas d'usage : salaires payés en mars pour des
-- factures de janvier/février. Priorité de reconnaissance P&L :
--   pnl_month (explicite) > mois du check-in du booking lié > date bancaire.
-- La trésorerie, elle, reste toujours sur la date bancaire réelle.
alter table public.fin_transactions
  add column if not exists pnl_month text
  check (pnl_month is null or pnl_month ~ '^\d{4}-(0[1-9]|1[0-2])$');
