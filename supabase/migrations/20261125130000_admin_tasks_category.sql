-- Area (espace physique) vs Category (type de tâche) — deux champs distincts
-- (25 nov 2026, demande Geoffroy). Appliquée en prod via execute_sql le même
-- jour (historisée) ; les areas non physiques de l'import Loïs ont été
-- déplacées vers category (Water filtering & fountains, Systems, Pedro
-- follow-ups, Carlos situation, Works & contractors, Admin & finance,
-- Yearly (spring)).

alter table public.admin_tasks add column if not exists category text;
