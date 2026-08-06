-- Payer (6 août 2026) — qui a payé la dépense (carte Revolut de qui / compte).
-- Alimenté par l'import Google Sheet "QdA Expenses & Revenues" et affiché
-- dans l'onglet Finance > Transactions.
alter table public.fin_transactions
  add column if not exists payer text;
