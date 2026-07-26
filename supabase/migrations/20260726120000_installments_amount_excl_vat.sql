-- Réconciliation paiements (juillet 2026) : montant hors TVA par installment.
-- amount_due reste le montant TVAC (source de vérité pour les totaux/gauges) ;
-- amount_excl_vat est informatif (affiché "excl. VAT" dans l'admin).
-- NULL = inconnu (anciens installments ou saisie manuelle sans HT).
alter table public.payment_installments
  add column if not exists amount_excl_vat numeric(10,2);
