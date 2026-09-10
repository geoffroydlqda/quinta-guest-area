-- Ecriture ATOMIQUE d'une cle dans app_settings.internal (10 sept 2026).
-- Contexte : revolut-sync faisait lire-puis-reecrire tout l'objet ; une
-- lecture en echec transitoire a ecrase TOUTES les cles internes (cron_key,
-- moloni, stripe, revolut, github) dans la nuit du 9 au 10 sept. Ce merge
-- jsonb en une seule instruction ne peut pas perdre les autres cles.
create or replace function public.set_internal_value(k text, v text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.app_settings
  set value = coalesce(value, '{}'::jsonb) || jsonb_build_object(k, v)
  where key = 'internal';
$$;
revoke execute on function public.set_internal_value(text, text) from public;
revoke execute on function public.set_internal_value(text, text) from anon;
revoke execute on function public.set_internal_value(text, text) from authenticated;
grant execute on function public.set_internal_value(text, text) to service_role;
