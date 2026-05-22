
REVOKE EXECUTE ON FUNCTION public.is_admin_email() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_create_booking_for_profile() FROM PUBLIC, anon, authenticated;
-- Allow RLS policies (which run as the calling role) to still evaluate is_admin_email
GRANT EXECUTE ON FUNCTION public.is_admin_email() TO authenticated;
