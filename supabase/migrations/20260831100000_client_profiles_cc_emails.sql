-- 31 aout 2026 — adresses email secondaires sur la fiche client :
-- tous les emails guests (demandes/confirmations de paiement, regles auto,
-- rappels, invitations, transport) partent au principal avec ces adresses en CC.
alter table public.client_profiles
  add column if not exists cc_emails text[];
