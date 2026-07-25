-- Contrôle du verrouillage d'édition par booking (demande produit) :
-- 1) Le mode admin "Open as guest" n'est jamais verrouillé (géré côté front).
-- 2) edit_lock_override = true rouvre l'édition au guest même à moins de
--    3 jours de l'arrivée (bouton "Unlock editing" dans la fiche admin).
alter table public.bookings
  add column if not exists edit_lock_override boolean not null default false;
