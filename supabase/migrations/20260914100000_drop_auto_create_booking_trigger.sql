-- Supprime le trigger heritee de la phase Lovable (14 sept 2026) : il creait
-- un booking VIDE pour tout compte sans booking (guest_profiles insert).
-- Consequence reelle : bookings fantomes "No dates set" quand un organisateur
-- cree son compte avant de cliquer le lien d'invitation (cas Simone/Camille).
-- Le flux actuel n'en a plus besoin : un compte sans booking voit l'ecran
-- dedie du Dashboard, et le claim rattache le vrai booking.
drop trigger if exists auto_create_booking_for_profile_trigger on public.guest_profiles;
drop function if exists public.auto_create_booking_for_profile();
