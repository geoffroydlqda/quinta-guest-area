-- TVA par échéance + paiement groupé Stripe + remise rental au niveau du booking.
-- * vat_rate : taux de TVA (%) de l'échéance — rental 23, catering 13,
--   extra au choix 6/13/23 (radio à la création). HT calculé automatiquement.
-- * stripe_session_id : échéances payées dans la même session Stripe Checkout
--   -> une seule fatura-recibo à plusieurs lignes.
-- * bookings.rental_discount : remise TVAC sur le rental, répartie au prorata
--   sur les lignes rental des factures (discount % par ligne dans Moloni).
alter table public.payment_installments
  add column if not exists vat_rate numeric,
  add column if not exists stripe_session_id text;

alter table public.bookings
  add column if not exists rental_discount numeric;

-- Backfill des taux existants selon la catégorie (cash = 0, HT = TVAC).
update public.payment_installments set vat_rate = 0 where vat_rate is null and is_cash = true;
update public.payment_installments set vat_rate = 13 where vat_rate is null and category = 'catering';
update public.payment_installments set vat_rate = 23 where vat_rate is null and category in ('rental','extra','discount');

create index if not exists idx_payment_installments_stripe_session
  on public.payment_installments(stripe_session_id) where stripe_session_id is not null;
