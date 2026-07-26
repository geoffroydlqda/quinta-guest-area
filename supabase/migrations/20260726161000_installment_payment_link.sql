-- Lien de paiement par échéance (Wise, etc.) : collé manuellement par l'admin
-- dans la page Payments en attendant une intégration API. Quand il est présent,
-- les emails de rappel affichent un bouton "Pay now" vers ce lien.
alter table public.payment_installments
  add column if not exists payment_link text;
