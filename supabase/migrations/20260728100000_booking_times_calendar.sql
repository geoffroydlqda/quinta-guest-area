-- Heures de check-in/check-out par booking (défaut 15h / 11h, modifiables)
-- + lien vers l'événement Google Calendar "Events" (sync bookings → calendrier).
alter table public.bookings
  add column if not exists check_in_time time not null default '15:00',
  add column if not exists check_out_time time not null default '11:00',
  add column if not exists google_calendar_event_id text,
  add column if not exists calendar_sync_status text,
  add column if not exists calendar_synced_at timestamptz;
