-- Paiements présentés en USD (guests hors zone SEPA) : trace du montant payé
-- en dollars et du taux EUR->USD figé au moment du paiement. La facture reste
-- en EUR ; l'écart de change part en charges financières.
alter table public.payment_installments
  add column if not exists paid_usd numeric,
  add column if not exists usd_rate numeric;
