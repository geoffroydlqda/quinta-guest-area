-- Remises (demande produit) : catégorie 'discount' sur payment_installments.
-- Montants stockés NÉGATIFS (saisis en positif dans l'admin), statut 'paid'
-- d'office (une remise n'est jamais "en attente" et ne déclenche aucun rappel).
-- Dans le dashboard, les remises se déduisent du bucket Rental (sémantique P&L
-- "Remises (location)" — l'objectif rental est net de remises).
alter table public.payment_installments drop constraint if exists payment_installments_category_check;
alter table public.payment_installments add constraint payment_installments_category_check
  check (category = any (array['rental'::text, 'catering'::text, 'extra'::text, 'discount'::text]));
