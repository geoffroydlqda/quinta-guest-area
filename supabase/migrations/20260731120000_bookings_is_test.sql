-- Mode test : bookings d'essai (flag), exclus des stats du dashboard,
-- des tuiles Payments et (à terme) des rappels/sync. Backfill : les bookings
-- créés avec l'email personnel de Geoffroy sont des tests.
alter table public.bookings add column if not exists is_test boolean not null default false;
update public.bookings set is_test = true where lower(email) = 'geoffroy.delichtervelde@gmail.com';
