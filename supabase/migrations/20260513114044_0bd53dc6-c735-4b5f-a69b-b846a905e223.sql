DROP POLICY IF EXISTS "Admins can view deletion log" ON public.deleted_entries_log;
CREATE POLICY "Admins can view deletion log"
ON public.deleted_entries_log
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