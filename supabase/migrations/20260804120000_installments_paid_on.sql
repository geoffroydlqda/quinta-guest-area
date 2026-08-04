-- Trésorerie (4 août 2026) : date réelle d'encaissement des échéances.
-- Les paiements CASH n'apparaissent pas dans le ledger Revolut : la trésorerie
-- les lit directement depuis payment_installments (is_cash + paid), datés par
-- paid_on. Renseigné désormais à chaque marquage "paid" (webhook Stripe et
-- boutons admin) ; backfill = due_date pour l'historique.
alter table public.payment_installments add column if not exists paid_on date;
update public.payment_installments set paid_on = due_date where status = 'paid' and paid_on is null and due_date is not null;
