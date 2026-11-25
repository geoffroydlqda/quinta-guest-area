-- Sous-tâches + récurrence annuelle (25 nov 2026, demande Geoffroy).
-- Appliquée en production via execute_sql le 25 nov 2026 (historisée).

-- Sous-tâches : une tâche peut pointer vers un parent ; suppression en cascade.
alter table public.admin_tasks
  add column if not exists parent_id uuid references public.admin_tasks(id) on delete cascade;
create index if not exists idx_admin_tasks_parent
  on public.admin_tasks(parent_id) where parent_id is not null;

-- Récurrence annuelle en plus de weekly/monthly/quarterly.
alter table public.admin_tasks drop constraint if exists admin_tasks_repeats_check;
alter table public.admin_tasks add constraint admin_tasks_repeats_check
  check (repeats = any (array['none'::text,'weekly'::text,'monthly'::text,'quarterly'::text,'yearly'::text]));
