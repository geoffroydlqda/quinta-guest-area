-- Paiements du staff catering (12 août 2026) : taux horaire OU journalier,
-- méthode cash/virement, statut payé.
-- Marqué payé en CASH -> le front crée une fin_transaction manuelle liée à
-- l'événement (cash flow + P&L) et stocke son id dans fin_tx_id.
-- Marqué payé en VIREMENT -> aucun mouvement créé : la ligne bancaire
-- arrivera par la synchro Revolut et sera catégorisée dans Finance.
alter table public.event_staff
  add column if not exists rate_type text not null default 'daily'
    check (rate_type in ('daily', 'hourly')),
  add column if not exists method text not null default 'bank'
    check (method in ('bank', 'cash')),
  add column if not exists paid boolean not null default false,
  add column if not exists paid_on date,
  add column if not exists fin_tx_id uuid references public.fin_transactions(id) on delete set null;
