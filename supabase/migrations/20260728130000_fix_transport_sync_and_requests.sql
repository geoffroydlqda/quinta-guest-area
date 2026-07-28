-- Deux corrections transport (juillet 2026) :
--
-- 1. Le trigger prevent_trip_sync_field_update annulait silencieusement les
--    écritures des champs de sync (google_calendar_event_id, sync_status…)
--    faites par les Edge Functions via le service role (pas d'email JWT ->
--    is_admin_email() = false). Conséquence : le backfill calendrier recréait
--    les événements à chaque exécution (doublons dans Google Calendar).
--    Le trigger ne vise que les guests (rôles anon/authenticated) : on laisse
--    passer service_role et postgres, qui sont de toute façon tout-puissants.
--
-- 2. transportation_requests avait une contrainte UNIQUE(user_id), héritée du
--    modèle "un booking par user". Un user avec plusieurs bookings (ou l'admin
--    en mode impersonation sur un 2e booking) ne pouvait plus créer sa demande
--    -> "Failed to load transportation data". On passe à : une demande par
--    booking (unique sur booking_id), et une seule demande legacy sans booking
--    par user.

create or replace function public.prevent_trip_sync_field_update()
returns trigger language plpgsql as $$
BEGIN
  IF current_user in ('service_role', 'postgres')
     OR coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
     OR public.is_admin_email() THEN
    RETURN NEW;
  END IF;

  IF NEW.google_calendar_event_id IS DISTINCT FROM OLD.google_calendar_event_id THEN NEW.google_calendar_event_id := OLD.google_calendar_event_id; END IF;
  IF NEW.last_synced_at           IS DISTINCT FROM OLD.last_synced_at           THEN NEW.last_synced_at           := OLD.last_synced_at;           END IF;
  IF NEW.sync_status              IS DISTINCT FROM OLD.sync_status              THEN NEW.sync_status              := OLD.sync_status;              END IF;
  IF NEW.sync_error               IS DISTINCT FROM OLD.sync_error               THEN NEW.sync_error               := OLD.sync_error;               END IF;
  IF NEW.custom_price             IS DISTINCT FROM OLD.custom_price             THEN NEW.custom_price             := OLD.custom_price;             END IF;

  RETURN NEW;
END;
$$;

alter table public.transportation_requests
  drop constraint if exists transportation_requests_user_id_key;

create unique index if not exists uq_transportation_requests_booking
  on public.transportation_requests (booking_id)
  where booking_id is not null;

create unique index if not exists uq_transportation_requests_user_legacy
  on public.transportation_requests (user_id)
  where booking_id is null;
