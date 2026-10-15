-- Etat "paiement en cours" sur les echeances (15 oct 2026).
-- Un paiement asynchrone (SEPA Direct Debit, virement, ACH) est initie des que
-- le guest termine le checkout Stripe, mais l'argent n'arrive que T+6 jours
-- ouvres. Avant, rien n'etait visible entre "pending" et "paid" : l'admin
-- pouvait relancer (ou regrouper) une echeance deja en cours de paiement.
-- stripe-webhook pose processing_since/processing_method sur
-- checkout.session.completed (payment_status != paid) et les efface quand le
-- paiement aboutit (paid) ou echoue (async_payment_failed).
alter table public.payment_installments
  add column if not exists processing_since timestamptz,
  add column if not exists processing_method text;

comment on column public.payment_installments.processing_since is
  'Paiement asynchrone (SEPA/virement/ACH) initie par le guest — en attente de confirmation bancaire. Pose par stripe-webhook, efface au succes ou a l''echec.';
comment on column public.payment_installments.processing_method is
  'Methode du paiement en cours (sepa_debit, customer_balance, us_bank_account...).';
