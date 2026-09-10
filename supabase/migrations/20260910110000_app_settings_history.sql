-- Historique automatique de app_settings (10 sept 2026, suite a l'incident
-- de la nuit du 9 : la ligne 'internal' ecrasee = toutes les cles perdues,
-- plan Free sans backup). Chaque UPDATE/DELETE archive l'ANCIENNE version —
-- restauration en une requete. Purge : on garde 90 jours.
create table if not exists public.app_settings_history (
  id bigint generated always as identity primary key,
  key text not null,
  old_value jsonb,
  changed_at timestamptz not null default now()
);
alter table public.app_settings_history enable row level security;
-- service_role uniquement (aucune policy = aucun acces anon/authenticated)

create or replace function public.app_settings_archive()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into app_settings_history (key, old_value) values (old.key, old.value);
  delete from app_settings_history where changed_at < now() - interval '90 days';
  return coalesce(new, old);
end $$;

drop trigger if exists app_settings_archive_trg on public.app_settings;
create trigger app_settings_archive_trg
  before update or delete on public.app_settings
  for each row execute function public.app_settings_archive();
