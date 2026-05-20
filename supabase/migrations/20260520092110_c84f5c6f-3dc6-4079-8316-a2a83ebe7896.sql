ALTER TABLE public.transportation_trips
  ADD COLUMN IF NOT EXISTS google_calendar_event_id text,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS sync_error text;

CREATE INDEX IF NOT EXISTS idx_trans_trips_sync_status ON public.transportation_trips(sync_status);
CREATE INDEX IF NOT EXISTS idx_trans_trips_event_id ON public.transportation_trips(google_calendar_event_id);