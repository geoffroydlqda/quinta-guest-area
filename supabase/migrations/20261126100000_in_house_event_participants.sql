-- Events IN-HOUSE (26 nov 2026, demande Geoffroy) : nouveau type d'événement
-- 'in_house' (Dia do Amor, Silêncio — organisés par la maison, pas de liens
-- de paiement guest) + table des participants avec facture individuelle.
-- Appliquée en prod via execute_sql le 26 nov 2026 (historisée) ; Silencio
-- (78084fa6) et Dia do amor (a0cdd458) basculés en in_house, 26 participants
-- Silêncio insérés (données Stripe Terra + faturas série TERRA).

alter table public.bookings drop constraint if exists bookings_event_type_check;
alter table public.bookings add constraint bookings_event_type_check
  check (event_type = any (array['retreat'::text,'wedding'::text,'other'::text,'day_retreat'::text,'in_house'::text]));

create table if not exists public.event_participants (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  name text not null,
  email text,
  amount_ttc numeric(10,2),
  paid_on date,
  source text not null default 'stripe' check (source in ('stripe','cash','transfer','other')),
  moloni_document_id integer,
  invoice_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.event_participants enable row level security;
revoke all on public.event_participants from anon, authenticated;
grant select, insert, update, delete on public.event_participants to authenticated;
create policy event_participants_admin_all on public.event_participants
  for all to authenticated using (public.is_admin_email()) with check (public.is_admin_email());
create index if not exists idx_event_participants_booking on public.event_participants(booking_id);
