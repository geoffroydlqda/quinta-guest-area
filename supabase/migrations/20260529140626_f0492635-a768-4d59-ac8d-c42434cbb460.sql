
-- 1) Admin predicate sourced from session JWT only
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(coalesce((auth.jwt() ->> 'email'), '')) IN (
    'hello@quintamor.com',
    'loïs@quintamor.com',
    'lois@quintamor.com',
    '977luisferreira@gmail.com'
  )
$$;

-- =========================================================
-- guest_profiles
-- =========================================================
DROP POLICY IF EXISTS "Users can view their own profile" ON public.guest_profiles;
DROP POLICY IF EXISTS "Users can create their own profile" ON public.guest_profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.guest_profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON public.guest_profiles;

CREATE POLICY "Users can view their own profile" ON public.guest_profiles
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users can create their own profile" ON public.guest_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users can update their own profile" ON public.guest_profiles
  FOR UPDATE USING (auth.uid() = user_id OR public.is_admin())
  WITH CHECK (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Admins can delete profiles" ON public.guest_profiles
  FOR DELETE USING (public.is_admin());

-- =========================================================
-- room_setups
-- =========================================================
DROP POLICY IF EXISTS "Users can view their own room setups" ON public.room_setups;
DROP POLICY IF EXISTS "Users can create their own room setups" ON public.room_setups;
DROP POLICY IF EXISTS "Users can update their own room setups" ON public.room_setups;
DROP POLICY IF EXISTS "Users can delete their own room setups" ON public.room_setups;

CREATE POLICY "Users can view their own room setups" ON public.room_setups
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users can create their own room setups" ON public.room_setups
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users can update their own room setups" ON public.room_setups
  FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.is_admin())
  WITH CHECK (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users can delete their own room setups" ON public.room_setups
  FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.is_admin());

-- =========================================================
-- food_plans
-- =========================================================
DROP POLICY IF EXISTS "Users can view their own food plan" ON public.food_plans;
DROP POLICY IF EXISTS "Users can create their own food plan" ON public.food_plans;
DROP POLICY IF EXISTS "Users can update their own food plan" ON public.food_plans;
DROP POLICY IF EXISTS "Admins can delete food plans" ON public.food_plans;

CREATE POLICY "Users can view their own food plan" ON public.food_plans
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users can create their own food plan" ON public.food_plans
  FOR INSERT WITH CHECK (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users can update their own food plan" ON public.food_plans
  FOR UPDATE USING (auth.uid() = user_id OR public.is_admin())
  WITH CHECK (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Admins can delete food plans" ON public.food_plans
  FOR DELETE USING (public.is_admin());

-- =========================================================
-- transportation_requests
-- =========================================================
DROP POLICY IF EXISTS "Users can view their own transportation" ON public.transportation_requests;
DROP POLICY IF EXISTS "Users can create their own transportation" ON public.transportation_requests;
DROP POLICY IF EXISTS "Users can update their own transportation" ON public.transportation_requests;
DROP POLICY IF EXISTS "Users can delete their own transportation" ON public.transportation_requests;

CREATE POLICY "Users can view their own transportation" ON public.transportation_requests
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users can create their own transportation" ON public.transportation_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users can update their own transportation" ON public.transportation_requests
  FOR UPDATE USING (auth.uid() = user_id OR public.is_admin())
  WITH CHECK (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users can delete their own transportation" ON public.transportation_requests
  FOR DELETE USING (auth.uid() = user_id OR public.is_admin());

-- =========================================================
-- transportation_trips
-- =========================================================
DROP POLICY IF EXISTS "Users can view their own trips" ON public.transportation_trips;
DROP POLICY IF EXISTS "Users can create their own trips" ON public.transportation_trips;
DROP POLICY IF EXISTS "Users can update their own trips" ON public.transportation_trips;
DROP POLICY IF EXISTS "Users can delete their own trips" ON public.transportation_trips;
DROP POLICY IF EXISTS "Admins can update any trip" ON public.transportation_trips;
DROP POLICY IF EXISTS "Admins can view all trips" ON public.transportation_trips;

CREATE POLICY "Users can view their own trips" ON public.transportation_trips
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users can create their own trips" ON public.transportation_trips
  FOR INSERT WITH CHECK (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users can update their own trips" ON public.transportation_trips
  FOR UPDATE USING (auth.uid() = user_id OR public.is_admin())
  WITH CHECK (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users can delete their own trips" ON public.transportation_trips
  FOR DELETE USING (auth.uid() = user_id OR public.is_admin());

-- =========================================================
-- transportation_passengers
-- =========================================================
DROP POLICY IF EXISTS "Users can view their own passengers" ON public.transportation_passengers;
DROP POLICY IF EXISTS "Users can create their own passengers" ON public.transportation_passengers;
DROP POLICY IF EXISTS "Users can update their own passengers" ON public.transportation_passengers;
DROP POLICY IF EXISTS "Users can delete their own passengers" ON public.transportation_passengers;

CREATE POLICY "Users can view their own passengers" ON public.transportation_passengers
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users can create their own passengers" ON public.transportation_passengers
  FOR INSERT WITH CHECK (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users can update their own passengers" ON public.transportation_passengers
  FOR UPDATE USING (auth.uid() = user_id OR public.is_admin())
  WITH CHECK (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users can delete their own passengers" ON public.transportation_passengers
  FOR DELETE USING (auth.uid() = user_id OR public.is_admin());

-- =========================================================
-- docs_ack
-- =========================================================
DROP POLICY IF EXISTS "Users can view their own docs ack" ON public.docs_ack;
DROP POLICY IF EXISTS "Users can create their own docs ack" ON public.docs_ack;
DROP POLICY IF EXISTS "Users can update their own docs ack" ON public.docs_ack;

CREATE POLICY "Users can view their own docs ack" ON public.docs_ack
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users can create their own docs ack" ON public.docs_ack
  FOR INSERT WITH CHECK (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users can update their own docs ack" ON public.docs_ack
  FOR UPDATE USING (auth.uid() = user_id OR public.is_admin())
  WITH CHECK (auth.uid() = user_id OR public.is_admin());

-- =========================================================
-- bookings  (keep existing is_admin_email() OR add is_admin())
-- =========================================================
DROP POLICY IF EXISTS "Users view their own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users update their own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admins insert bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admins delete bookings" ON public.bookings;

CREATE POLICY "Users view their own bookings" ON public.bookings
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin() OR is_admin_email());
CREATE POLICY "Users update their own bookings" ON public.bookings
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.is_admin() OR is_admin_email())
  WITH CHECK (auth.uid() = user_id OR public.is_admin() OR is_admin_email());
CREATE POLICY "Admins insert bookings" ON public.bookings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR is_admin_email());
CREATE POLICY "Admins delete bookings" ON public.bookings
  FOR DELETE TO authenticated
  USING (public.is_admin() OR is_admin_email());

-- =========================================================
-- payment_installments
-- =========================================================
DROP POLICY IF EXISTS "Users view own installments" ON public.payment_installments;
DROP POLICY IF EXISTS "Admins insert installments" ON public.payment_installments;
DROP POLICY IF EXISTS "Admins update installments" ON public.payment_installments;
DROP POLICY IF EXISTS "Admins delete installments" ON public.payment_installments;

CREATE POLICY "Users view own installments" ON public.payment_installments
  FOR SELECT TO authenticated
  USING (
    booking_id IN (SELECT id FROM public.bookings WHERE user_id = auth.uid())
    OR public.is_admin() OR is_admin_email()
  );
CREATE POLICY "Admins insert installments" ON public.payment_installments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR is_admin_email());
CREATE POLICY "Admins update installments" ON public.payment_installments
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR is_admin_email())
  WITH CHECK (public.is_admin() OR is_admin_email());
CREATE POLICY "Admins delete installments" ON public.payment_installments
  FOR DELETE TO authenticated
  USING (public.is_admin() OR is_admin_email());

-- =========================================================
-- storage.objects — invoices bucket: admin full access
-- =========================================================
DROP POLICY IF EXISTS "Admins read invoices" ON storage.objects;
DROP POLICY IF EXISTS "Admins write invoices" ON storage.objects;
DROP POLICY IF EXISTS "Admins update invoices" ON storage.objects;
DROP POLICY IF EXISTS "Admins delete invoices" ON storage.objects;

CREATE POLICY "Admins read invoices" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'invoices' AND public.is_admin());
CREATE POLICY "Admins write invoices" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'invoices' AND public.is_admin());
CREATE POLICY "Admins update invoices" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'invoices' AND public.is_admin())
  WITH CHECK (bucket_id = 'invoices' AND public.is_admin());
CREATE POLICY "Admins delete invoices" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'invoices' AND public.is_admin());
