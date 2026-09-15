-- Suivi d'ouverture des emails envoyes (15 sept 2026).
-- Chaque envoi Resend garde son id (resend_id) ; la fonction email-status-sync
-- interroge l'API Resend a la demande et remplit last_event / opened_at.
-- L'open tracking doit etre active dans le dashboard Resend (domaine
-- quintamor.com) pour que les ouvertures remontent.
alter table public.reminder_log
  add column if not exists resend_id text,
  add column if not exists last_event text,
  add column if not exists opened_at timestamptz;

alter table public.email_rule_log
  add column if not exists resend_id text,
  add column if not exists last_event text,
  add column if not exists opened_at timestamptz;

create index if not exists reminder_log_resend_idx
  on public.reminder_log (resend_id) where resend_id is not null;
create index if not exists email_rule_log_resend_idx
  on public.email_rule_log (resend_id) where resend_id is not null;
