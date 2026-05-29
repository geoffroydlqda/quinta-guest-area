
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT lower(coalesce((auth.jwt() ->> 'email'), '')) IN (
    'hello@quintamor.com',
    'loïs@quintamor.com',
    'lois@quintamor.com',
    '977luisferreira@gmail.com'
  )
$$;
