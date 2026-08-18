-- Demi-heures pour le staff catering (12 août 2026) : 6h30 = 6.5 heures.
-- paid_days était integer — les quantités fractionnaires étaient tronquées.
alter table public.event_staff
  alter column paid_days type numeric using paid_days::numeric;
