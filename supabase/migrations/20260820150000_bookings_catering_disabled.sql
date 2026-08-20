-- Catering desactivable par booking (20 aout 2026), comme disabled_rooms :
-- l'onglet Catering disparait de la guest area du booking concerne.
alter table public.bookings add column if not exists catering_disabled boolean not null default false;
comment on column public.bookings.catering_disabled is 'Catering retire de ce booking par l''admin : onglet Catering masque dans la guest area (comme les chambres desactivees).';
