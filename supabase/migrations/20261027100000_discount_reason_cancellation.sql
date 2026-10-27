-- 27 oct 2026 (cas Yuna Moutran / Lauren O'Donohue) : nouvelle raison de
-- remise 'cancellation' pour les echeances negatives de remboursement sur
-- annulation. Le routage P&L vers la ligne "Cancelled events — fees retained"
-- se fait par bookings.cancelled_at, la raison reste informative.
alter table public.payment_installments drop constraint if exists payment_installments_discount_reason_check;
alter table public.payment_installments add constraint payment_installments_discount_reason_check
  check (discount_reason is null or discount_reason in ('negotiation','internal','other','cancellation'));
