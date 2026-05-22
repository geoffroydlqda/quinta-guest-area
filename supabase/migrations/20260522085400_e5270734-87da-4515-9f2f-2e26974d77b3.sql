
-- ============================================================
-- Phase 1: Bookings foundation
-- ============================================================

-- 1. Payment status enum
DO $$ BEGIN
  CREATE TYPE public.payment_status AS ENUM ('pending', 'deposit_paid', 'paid_in_full', 'overdue');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. Bookings table
CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retreat_name text NOT NULL DEFAULT '',
  first_name text,
  last_name text,
  email text NOT NULL,
  guest_count integer NOT NULL DEFAULT 1,
  check_in_date date,
  check_out_date date,
  payment_status public.payment_status NOT NULL DEFAULT 'pending',
  deposit_amount numeric,
  remaining_balance numeric,
  invitation_token text UNIQUE,
  invitation_claimed boolean NOT NULL DEFAULT false,
  invitation_expires_at timestamptz,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_admin boolean NOT NULL DEFAULT false,
  internal_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON public.bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_email ON public.bookings(lower(email));
CREATE INDEX IF NOT EXISTS idx_bookings_invitation_token ON public.bookings(invitation_token);

-- 3. updated_at trigger
DROP TRIGGER IF EXISTS update_bookings_updated_at ON public.bookings;
CREATE TRIGGER update_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 4. RLS
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Admin email check helper (reuses pattern from transportation_trips policies)
CREATE OR REPLACE FUNCTION public.is_admin_email()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(trim(coalesce((auth.jwt() ->> 'email'), ''))) = ANY (ARRAY[
    'hello@quintamor.com',
    'loïs@quintamor.com',
    'lois@quintamor.com',
    '977luisferreira@gmail.com'
  ]);
$$;

CREATE POLICY "Users view their own bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_admin_email());

CREATE POLICY "Users update their own bookings"
  ON public.bookings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR public.is_admin_email())
  WITH CHECK (auth.uid() = user_id OR public.is_admin_email());

CREATE POLICY "Admins insert bookings"
  ON public.bookings FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_email());

CREATE POLICY "Admins delete bookings"
  ON public.bookings FOR DELETE
  TO authenticated
  USING (public.is_admin_email());

-- 5. Add nullable booking_id to existing tables
ALTER TABLE public.food_plans               ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;
ALTER TABLE public.transportation_requests  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;
ALTER TABLE public.transportation_trips     ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;
ALTER TABLE public.transportation_passengers ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;
ALTER TABLE public.room_setups              ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;
ALTER TABLE public.docs_ack                 ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_food_plans_booking_id              ON public.food_plans(booking_id);
CREATE INDEX IF NOT EXISTS idx_transportation_requests_booking_id ON public.transportation_requests(booking_id);
CREATE INDEX IF NOT EXISTS idx_transportation_trips_booking_id    ON public.transportation_trips(booking_id);
CREATE INDEX IF NOT EXISTS idx_transportation_passengers_booking_id ON public.transportation_passengers(booking_id);
CREATE INDEX IF NOT EXISTS idx_room_setups_booking_id             ON public.room_setups(booking_id);
CREATE INDEX IF NOT EXISTS idx_docs_ack_booking_id                ON public.docs_ack(booking_id);

-- 6. Backfill: 1 booking per existing guest_profile
INSERT INTO public.bookings (
  id, retreat_name, first_name, last_name, email, guest_count,
  check_in_date, check_out_date, payment_status,
  invitation_claimed, user_id, created_by_admin, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  '' AS retreat_name,
  gp.first_name,
  gp.last_name,
  gp.email,
  COALESCE(gp.guests_count, 1),
  gp.check_in_date,
  gp.check_out_date,
  'pending'::public.payment_status,
  true,        -- already claimed (user exists)
  gp.user_id,
  false,
  gp.created_at,
  gp.updated_at
FROM public.guest_profiles gp
WHERE NOT EXISTS (
  SELECT 1 FROM public.bookings b WHERE b.user_id = gp.user_id
);

-- 7. Backfill booking_id on child tables (link each row to the user's single booking)
UPDATE public.food_plans fp
SET booking_id = b.id
FROM public.bookings b
WHERE fp.user_id = b.user_id AND fp.booking_id IS NULL;

UPDATE public.transportation_requests tr
SET booking_id = b.id
FROM public.bookings b
WHERE tr.user_id = b.user_id AND tr.booking_id IS NULL;

UPDATE public.transportation_trips tt
SET booking_id = b.id
FROM public.bookings b
WHERE tt.user_id = b.user_id AND tt.booking_id IS NULL;

UPDATE public.transportation_passengers tp
SET booking_id = b.id
FROM public.bookings b
WHERE tp.user_id = b.user_id AND tp.booking_id IS NULL;

UPDATE public.room_setups rs
SET booking_id = b.id
FROM public.bookings b
WHERE rs.user_id = b.user_id AND rs.booking_id IS NULL;

UPDATE public.docs_ack da
SET booking_id = b.id
FROM public.bookings b
WHERE da.user_id = b.user_id AND da.booking_id IS NULL;

-- 8. Trigger: auto-create a booking when a new guest_profile appears (legacy signup path)
CREATE OR REPLACE FUNCTION public.auto_create_booking_for_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE user_id = NEW.user_id) THEN
    INSERT INTO public.bookings (
      retreat_name, first_name, last_name, email, guest_count,
      check_in_date, check_out_date, payment_status,
      invitation_claimed, user_id, created_by_admin
    ) VALUES (
      '',
      NEW.first_name,
      NEW.last_name,
      NEW.email,
      COALESCE(NEW.guests_count, 1),
      NEW.check_in_date,
      NEW.check_out_date,
      'pending',
      true,
      NEW.user_id,
      false
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_create_booking_for_profile_trigger ON public.guest_profiles;
CREATE TRIGGER auto_create_booking_for_profile_trigger
  AFTER INSERT ON public.guest_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_booking_for_profile();
