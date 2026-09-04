-- guest_count devient optionnel (4 sept 2026) : vide = le retreat leader le
-- renseigne lui-meme a sa premiere connexion ; le dashboard projette alors
-- 14 participants pour le catering attendu. Les 14 retraites 2027 non
-- reclamees (guest_count reste au defaut 1) ont ete remises a NULL.
alter table public.bookings alter column guest_count drop not null;
alter table public.bookings alter column guest_count drop default;
