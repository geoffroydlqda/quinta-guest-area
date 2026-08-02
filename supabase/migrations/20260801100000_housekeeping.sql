-- ---------------------------------------------------------------------------
-- Housekeeping (1 août 2026) — l'onglet Room setup devient Housekeeping.
-- Sessions de ménage programmées par booking : date, heures, équipe
-- (Tina / Vanessa / Anabella / Extra), notes. Chaque session est poussée
-- dans le calendrier Google dédié "Housekeeping" (gcal_event_id).
-- ---------------------------------------------------------------------------
create table if not exists public.housekeeping_sessions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  date date not null,
  start_time time,
  end_time time,
  team text[] not null default '{}',
  notes text,
  gcal_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists housekeeping_booking_idx on public.housekeeping_sessions (booking_id);
create index if not exists housekeeping_date_idx on public.housekeeping_sessions (date);

alter table public.housekeeping_sessions enable row level security;

drop policy if exists "housekeeping admin all" on public.housekeeping_sessions;
create policy "housekeeping admin all" on public.housekeeping_sessions
  for all using (public.is_admin()) with check (public.is_admin());
