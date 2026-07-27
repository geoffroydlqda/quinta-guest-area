-- Rattache chaque booking à une fiche client (client_profiles), pour qu'un
-- même guest puisse avoir plusieurs bookings créés avec des emails différents
-- (ex. Tommy Querton ×3 bookings internal+…). Le regroupement de l'onglet
-- Guests utilise client_id d'abord, sinon l'email.
alter table public.bookings
  add column if not exists client_id uuid references public.client_profiles(id) on delete set null;

create index if not exists idx_bookings_client_id on public.bookings(client_id);

-- Backfill : chaque booking pointe vers la fiche client de son email.
update public.bookings b
set client_id = cp.id
from public.client_profiles cp
where b.client_id is null
  and cp.email = lower(b.email);
