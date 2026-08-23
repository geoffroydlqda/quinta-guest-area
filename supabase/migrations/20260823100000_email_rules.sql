-- Moteur d'emails automatiques configurables depuis l'admin (23 aout 2026).
-- email_rules : regles creees par l'admin (declencheur + decalage en jours,
-- sujet/corps avec variables {{...}}, bouton optionnel).
-- email_rule_log : journal des envois avec cle de dedoublonnage (un envoi max
-- par regle/booking/echeance).

create table if not exists public.email_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  enabled boolean not null default false,
  trigger text not null check (trigger in ('check_in', 'check_out', 'due_date')),
  offset_days integer not null default 0 check (offset_days between -365 and 365),
  event_type_filter text check (event_type_filter in ('retreat', 'wedding', 'other', 'day_retreat')),
  subject text not null,
  body text not null,
  cta text not null default 'none' check (cta in ('none', 'guest_area', 'pay')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_rules enable row level security;
revoke all on public.email_rules from anon, authenticated;

create policy "Admins manage email rules"
  on public.email_rules
  for all
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.email_rules to authenticated;

create table if not exists public.email_rule_log (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.email_rules(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  installment_id uuid,
  recipient text,
  subject text,
  status text not null default 'sent',
  error text,
  created_at timestamptz not null default now(),
  dedup_key text not null
);

create unique index if not exists email_rule_log_dedup_key_idx
  on public.email_rule_log (dedup_key);

alter table public.email_rule_log enable row level security;
revoke all on public.email_rule_log from anon, authenticated;

create policy "Admins read email rule log"
  on public.email_rule_log
  for select
  using (public.is_admin());

grant select on public.email_rule_log to authenticated;
