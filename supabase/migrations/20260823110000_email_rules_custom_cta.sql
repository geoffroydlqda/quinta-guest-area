-- Bouton personnalise sur les emails automatiques (23 aout 2026) :
-- cta = 'custom' + cta_label / cta_url (ex : lien vers un feedback form,
-- un guide d'arrivee, etc.).

alter table public.email_rules add column if not exists cta_label text;
alter table public.email_rules add column if not exists cta_url text;
alter table public.email_rules drop constraint if exists email_rules_cta_check;
alter table public.email_rules add constraint email_rules_cta_check check (cta in ('none', 'guest_area', 'pay', 'custom'));
