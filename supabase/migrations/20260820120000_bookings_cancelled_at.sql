-- Annulation de booking (20 aout 2026) : un booking marque cancelled disparait
-- du calendrier Google, des listes admin et des stats, sans etre supprime.
alter table public.bookings add column if not exists cancelled_at timestamptz;
comment on column public.bookings.cancelled_at is 'Booking annule par l''admin : exclu du calendrier Google, des listes et des stats. NULL = actif.';
