
-- Raise max guests from 21 to 22
ALTER TABLE public.guest_profiles DROP CONSTRAINT IF EXISTS guests_count_range;
ALTER TABLE public.guest_profiles
  ADD CONSTRAINT guests_count_range CHECK (guests_count >= 1 AND guests_count <= 22);

-- Admin-defined custom price for custom-offer trips
ALTER TABLE public.transportation_trips
  ADD COLUMN IF NOT EXISTS custom_price numeric(10,2);

-- Allow admins to update any trip (e.g. to set custom_price)
DROP POLICY IF EXISTS "Admins can update any trip" ON public.transportation_trips;
CREATE POLICY "Admins can update any trip"
ON public.transportation_trips
FOR UPDATE
TO authenticated
USING (
  lower(trim(both from coalesce((auth.jwt() ->> 'email'), ''))) = ANY (ARRAY[
    'hello@quintamor.com',
    'loïs@quintamor.com',
    'lois@quintamor.com',
    '977luisferreira@gmail.com'
  ])
)
WITH CHECK (
  lower(trim(both from coalesce((auth.jwt() ->> 'email'), ''))) = ANY (ARRAY[
    'hello@quintamor.com',
    'loïs@quintamor.com',
    'lois@quintamor.com',
    '977luisferreira@gmail.com'
  ])
);

-- Allow admins to view any trip (for completeness — they already use service role function, but safer for direct reads)
DROP POLICY IF EXISTS "Admins can view all trips" ON public.transportation_trips;
CREATE POLICY "Admins can view all trips"
ON public.transportation_trips
FOR SELECT
TO authenticated
USING (
  lower(trim(both from coalesce((auth.jwt() ->> 'email'), ''))) = ANY (ARRAY[
    'hello@quintamor.com',
    'loïs@quintamor.com',
    'lois@quintamor.com',
    '977luisferreira@gmail.com'
  ])
);
