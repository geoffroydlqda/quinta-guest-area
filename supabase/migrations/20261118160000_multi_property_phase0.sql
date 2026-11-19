-- Multi-lieux phase 0 (18 nov 2026) : Terra da Paz rejoint l'admin.
-- Un booking appartient à un lieu ; défaut 'quinta' = comportement inchangé
-- pour tout l'existant. Le reste (échéances, catering, chambres, transports,
-- emails…) hérite du lieu par jointure sur bookings.
alter table public.bookings add column if not exists property text not null default 'quinta';
alter table public.bookings drop constraint if exists bookings_property_check;
alter table public.bookings add constraint bookings_property_check check (property in ('quinta','terra'));
create index if not exists bookings_property_idx on public.bookings (property);

-- Accès staff par lieu (null = tous les lieux), même philosophie
-- qu'allowed_tabs : filtrage d'INTERFACE, pas du cloisonnement RLS.
alter table public.staff_profiles add column if not exists allowed_properties text[];
