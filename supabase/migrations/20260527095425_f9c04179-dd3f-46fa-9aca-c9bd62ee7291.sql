
REVOKE ALL ON FUNCTION public.prevent_booking_sensitive_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_trip_sync_field_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_create_booking_for_profile() FROM PUBLIC, anon, authenticated;
