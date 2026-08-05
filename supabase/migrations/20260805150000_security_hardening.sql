-- Durcissement sécurité (5 août 2026) — suite à l'alerte Supabase du 3 août.
--
-- 1. CRITIQUE : payment_installments_backup_20260730 (sauvegarde du 30 juillet,
--    88 lignes) était exposée sans RLS -> lisible/modifiable avec la clé anon.
--    RLS activé sans aucune policy + droits API révoqués : plus accessible que
--    via service_role (les données de sauvegarde sont conservées).
alter table public.payment_installments_backup_20260730 enable row level security;
revoke all on table public.payment_installments_backup_20260730 from anon, authenticated;

-- 2. Fonctions trigger exposées en RPC : elles ne doivent jamais être appelées
--    par l'API (les triggers s'exécutent indépendamment du droit EXECUTE de
--    l'appelant, donc aucune régression).
revoke execute on function public.auto_create_booking_for_profile() from public, anon, authenticated;
revoke execute on function public.prevent_booking_sensitive_update() from public, anon, authenticated;
revoke execute on function public.touch_client_profiles() from public, anon, authenticated;
revoke execute on function public.prevent_trip_sync_field_update() from public, anon, authenticated;
revoke execute on function public.touch_event_staff() from public, anon, authenticated;

-- 3. search_path fixé sur les fonctions qui ne l'avaient pas (empêche le
--    détournement par un schéma malveillant placé avant public).
alter function public.touch_client_profiles() set search_path = public;
alter function public.prevent_trip_sync_field_update() set search_path = public;
alter function public.touch_event_staff() set search_path = public;

-- NOTE (volontairement inchangé, pour ne rien casser en production) :
-- - is_admin()/is_admin_email()/check_is_admin_email() restent exécutables par
--   anon/authenticated : ils sont appelés DANS les policies RLS avec les droits
--   de l'appelant — les révoquer casserait tout l'admin. Ils ne renvoient
--   qu'un booléen.
-- - admin_users : RLS sans policy = verrouillée côté API, lue uniquement par
--   les fonctions SECURITY DEFINER. C'est le comportement voulu.
-- - pg_net reste dans public : extension non relogeable sans risque pour les
--   crons (payment-reminders, revolut-bar-sync).
