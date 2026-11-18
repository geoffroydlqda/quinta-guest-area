-- TVA saisie en euros sur une depense (17 nov 2026, demande Geoffroy).
-- Une facture a plusieurs taux (6/13/23 %) n'a pas de "taux" unique : on stocke
-- le montant de TVA. Quand vat_amount est renseigne, il fait foi :
-- amount_net = |amount| - vat_amount, vat_rate = null.
alter table public.fin_transactions add column if not exists vat_amount numeric;
alter table public.fin_transactions add constraint fin_transactions_vat_amount_check check (vat_amount is null or vat_amount >= 0);
