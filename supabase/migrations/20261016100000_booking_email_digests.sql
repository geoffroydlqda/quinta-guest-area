-- Resume quotidien des emails par booking (16 oct 2026, demande Geoffroy).
-- Alimente par une tache planifiee Claude (lecture Gmail 1x/jour) : resume
-- des echanges + checklist d'actions pour l'admin, affiches dans une carte
-- "Email digest" de la fiche booking. La tache MERGE la checklist (les items
-- coches restent coches, les nouveaux s'ajoutent) ; l'admin coche depuis l'UI.
create table public.booking_email_digests (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  summary text not null default '',
  -- [{"id": "slug", "text": "...", "done": false, "done_at": null}]
  checklist jsonb not null default '[]'::jsonb,
  -- Date du message le plus recent integre au resume (borne de la
  -- prochaine recherche Gmail).
  last_email_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.booking_email_digests enable row level security;
revoke all on public.booking_email_digests from anon, authenticated;
grant select, update on public.booking_email_digests to authenticated;

-- Lecture + coche des cases par les admins ; l'ecriture du contenu vient du
-- service role (tache planifiee).
create policy booking_email_digests_admin_select on public.booking_email_digests
  for select to authenticated using (public.is_admin());
create policy booking_email_digests_admin_update on public.booking_email_digests
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
