
-- 1. Switch is_admin_email to SECURITY INVOKER (uses auth.jwt(), no elevated access needed)
CREATE OR REPLACE FUNCTION public.is_admin_email()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT lower(trim(coalesce((auth.jwt() ->> 'email'), ''))) = ANY (ARRAY[
    'hello@quintamor.com',
    'loïs@quintamor.com',
    'lois@quintamor.com',
    '977luisferreira@gmail.com'
  ]);
$function$;

-- 2. Guard bookings sensitive columns from non-admin modification
CREATE OR REPLACE FUNCTION public.prevent_booking_sensitive_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.is_admin_email() THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_status      IS DISTINCT FROM OLD.payment_status      THEN NEW.payment_status      := OLD.payment_status;      END IF;
  IF NEW.deposit_amount      IS DISTINCT FROM OLD.deposit_amount      THEN NEW.deposit_amount      := OLD.deposit_amount;      END IF;
  IF NEW.remaining_balance   IS DISTINCT FROM OLD.remaining_balance   THEN NEW.remaining_balance   := OLD.remaining_balance;   END IF;
  IF NEW.invitation_token    IS DISTINCT FROM OLD.invitation_token    THEN NEW.invitation_token    := OLD.invitation_token;    END IF;
  IF NEW.invitation_claimed  IS DISTINCT FROM OLD.invitation_claimed  THEN NEW.invitation_claimed  := OLD.invitation_claimed;  END IF;
  IF NEW.invitation_expires_at IS DISTINCT FROM OLD.invitation_expires_at THEN NEW.invitation_expires_at := OLD.invitation_expires_at; END IF;
  IF NEW.created_by_admin    IS DISTINCT FROM OLD.created_by_admin    THEN NEW.created_by_admin    := OLD.created_by_admin;    END IF;
  IF NEW.internal_notes      IS DISTINCT FROM OLD.internal_notes      THEN NEW.internal_notes      := OLD.internal_notes;      END IF;
  IF NEW.email               IS DISTINCT FROM OLD.email               THEN NEW.email               := OLD.email;               END IF;
  IF NEW.user_id             IS DISTINCT FROM OLD.user_id             THEN NEW.user_id             := OLD.user_id;             END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_prevent_sensitive_update ON public.bookings;
CREATE TRIGGER trg_bookings_prevent_sensitive_update
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_booking_sensitive_update();

-- 3. Guard transportation_trips sync fields from user modification
CREATE OR REPLACE FUNCTION public.prevent_trip_sync_field_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.is_admin_email() THEN
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

DROP TRIGGER IF EXISTS trg_trips_prevent_sync_field_update ON public.transportation_trips;
CREATE TRIGGER trg_trips_prevent_sync_field_update
  BEFORE UPDATE ON public.transportation_trips
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_trip_sync_field_update();
