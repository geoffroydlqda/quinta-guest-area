-- Interrupteur par booking : inclure ou non ce séjour dans la projection
-- "expected catering" du dashboard (certaines retraites ne prennent pas le
-- catering). Défaut = true ; ne concerne en pratique que les event_type='retreat'
-- à venir sans catering validé.
alter table public.bookings
  add column if not exists catering_expected boolean not null default true;
