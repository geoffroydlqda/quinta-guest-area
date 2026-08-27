-- 27 aout 2026 — paiements par virement bancaire (Wise, SEPA...) :
-- paid_bank_tx_id relie une echeance payee a la fin_transaction du virement
-- entrant qui l'a reglee. Sert aussi de cle de groupage pour la fatura-recibo
-- Moloni (plusieurs echeances payees par UN virement = UN document), comme
-- stripe_session_id pour les paiements Stripe.
alter table public.payment_installments
  add column if not exists paid_bank_tx_id uuid references public.fin_transactions(id) on delete set null;

create index if not exists payment_installments_paid_bank_tx_idx
  on public.payment_installments (paid_bank_tx_id) where paid_bank_tx_id is not null;
