-- 1er sept. 2026 — "pas de justificatif a attendre" : certaines depenses
-- (cash, pourboires, petits achats sans ticket) n'auront jamais de recu.
-- L'admin le notifie -> la ligne sort du filtre "No receipt".
alter table public.fin_transactions
  add column if not exists receipt_waived boolean not null default false;
