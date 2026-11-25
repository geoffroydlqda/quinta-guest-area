-- Tasks (25 nov 2026, demande Geoffroy) : centralise le task tracker créé par
-- Loïs (artifact « Quinta task tracker ») dans l'admin. Modèle repris de son
-- tracker (area, priorité H/M/L, statuts, échéance, récurrence, notes) +
-- assigné (staff), créateur, lieu, et notifications.
create table if not exists public.admin_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text,
  area text, -- zone/catégorie libre (pool, garden, admin…) — datalist côté UI
  property text not null default 'quinta' check (property in ('quinta','terra')),
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  status text not null default 'todo' check (status in ('todo','in_progress','done')),
  due_date date,
  -- Récurrence façon tracker de Loïs : à la complétion, l'UI recrée la
  -- prochaine occurrence (due_date + 1 sem / 1 mois / 3 mois).
  repeats text not null default 'none' check (repeats in ('none','weekly','monthly','quarterly')),
  assignee_id uuid references public.staff_profiles(id) on delete set null,
  created_by text, -- email de l'admin créateur
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.admin_tasks enable row level security;
drop policy if exists "admin_tasks admin all" on public.admin_tasks;
create policy "admin_tasks admin all" on public.admin_tasks
  for all using (public.is_admin()) with check (public.is_admin());

create index if not exists admin_tasks_status_due_idx on public.admin_tasks (status, due_date);
create index if not exists admin_tasks_assignee_idx on public.admin_tasks (assignee_id);

-- Centre de notifications : une ligne PAR destinataire (fan-out à la création/
-- assignation/complétion d'une tâche), read_at individuel. Filtrage par email
-- côté UI — même philosophie d'interface que allowed_tabs.
create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  type text not null default 'task',
  message text not null,
  task_id uuid references public.admin_tasks(id) on delete cascade,
  created_by text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

alter table public.admin_notifications enable row level security;
drop policy if exists "admin_notifications admin all" on public.admin_notifications;
create policy "admin_notifications admin all" on public.admin_notifications
  for all using (public.is_admin()) with check (public.is_admin());

create index if not exists admin_notifications_recipient_idx
  on public.admin_notifications (recipient_email, read_at);
