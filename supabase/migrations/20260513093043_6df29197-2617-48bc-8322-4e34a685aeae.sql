DROP POLICY IF EXISTS "Admins can view deletion log" ON public.deleted_entries_log;
CREATE POLICY "Admins can view deletion log"
ON public.deleted_entries_log
FOR SELECT
TO authenticated
USING (
  lower(trim(COALESCE(auth.jwt() ->> 'email', ''))) IN (
    'hello@quintamor.com',
    'loïs@quintamor.com'
  )
);