-- Onglet Catering (juillet 2026) : staff assigné par événement, avec
-- rémunération journalière et nombre de jours payés (en général nuits + 1
-- pour le kitchen staff).
create table if not exists public.event_staff (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  name text not null,
  role text,
  daily_fee numeric not null default 0,
  paid_days integer not null default 1,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_event_staff_booking on public.event_staff(booking_id);

alter table public.event_staff enable row level security;

create policy "Admins can read event staff"
  on public.event_staff for select using (public.is_admin());
create policy "Admins can insert event staff"
  on public.event_staff for insert with check (public.is_admin());
create policy "Admins can update event staff"
  on public.event_staff for update using (public.is_admin());
create policy "Admins can delete event staff"
  on public.event_staff for delete using (public.is_admin());

create or replace function public.touch_event_staff()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_event_staff_touch on public.event_staff;
create trigger trg_event_staff_touch
  before update on public.event_staff
  for each row execute function public.touch_event_staff();
