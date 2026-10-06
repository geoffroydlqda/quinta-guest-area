-- Raison du champ bookings.rental_discount (6 oct 2026) : route la remise
-- vers la bonne ligne du P&L — null/negotiation/internal = "Discounts —
-- negotiated", other = "Discounts — goodwill (post-stay)".
alter table public.bookings add column if not exists rental_discount_reason text
  check (rental_discount_reason is null or rental_discount_reason in ('negotiation','internal','other'));
