-- Phase 1 : infrastructure de rappels de paiement (DÉSACTIVÉE par défaut)
-- 1) app_settings : réglages applicatifs, dont l'interrupteur global des rappels (OFF)
-- 2) reminder_log : journal de tout email automatisé (traçabilité + dédoublonnage)
-- 3) pg_cron + pg_net : appel quotidien de la fonction payment-reminders
--    (la fonction sort immédiatement tant que reminders.enabled = false)

-- ---------------------------------------------------------------------------
-- app_settings
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Seuls les admins voient/modifient les réglages, et jamais la ligne 'internal'
-- (qui contient la clé du cron, gérée uniquement par le service role).
drop policy if exists "Admins manage app settings" on public.app_settings;
create policy "Admins manage app settings"
  on public.app_settings for all
  to authenticated
  using (public.is_admin_email() and key <> 'internal')
  with check (public.is_admin_email() and key <> 'internal');

insert into public.app_settings (key, value) values
  ('payment_reminders', '{"enabled": false, "days_before": 7, "days_overdue": 3}')
on conflict (key) do nothing;  -- ne jamais écraser l'interrupteur en re-jouant la migration

-- ---------------------------------------------------------------------------
-- reminder_log
-- ---------------------------------------------------------------------------
create table if not exists public.reminder_log (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('payment_upcoming', 'payment_overdue', 'invitation')),
  installment_id uuid references public.payment_installments(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  recipient text not null,
  subject text,
  status text not null default 'sent' check (status in ('sent', 'error')),
  error text,
  created_at timestamptz not null default now()
);

alter table public.reminder_log enable row level security;

drop policy if exists "Admins read reminder log" on public.reminder_log;
create policy "Admins read reminder log"
  on public.reminder_log for select
  to authenticated
  using (public.is_admin_email());
-- Écritures : service role uniquement (Edge Functions).

-- Un rappel de paiement d'un type donné ne part qu'UNE fois par échéance.
create unique index if not exists reminder_log_payment_dedupe
  on public.reminder_log (type, installment_id)
  where status = 'sent' and installment_id is not null and type <> 'invitation';

create index if not exists reminder_log_booking_idx on public.reminder_log (booking_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Cron quotidien (08:00 UTC) -> Edge Function payment-reminders
-- La clé d'authentification du cron vit dans app_settings key='internal'
-- (insérée manuellement, jamais dans le repo). La fonction la vérifie.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('payment-reminders-daily');
exception when others then
  null; -- pas encore planifié
end $$;

select cron.schedule(
  'payment-reminders-daily',
  '0 8 * * *',
  $CRON$
  select net.http_post(
    url := 'https://fnlgeeuohvethmfpsxpf.supabase.co/functions/v1/payment-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', coalesce((select value->>'cron_key' from public.app_settings where key = 'internal'), '')
    ),
    body := '{"source": "cron"}'::jsonb
  );
  $CRON$
);
