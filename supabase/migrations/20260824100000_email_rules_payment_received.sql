-- Emails automatiques v2 (24 aout 2026) :
-- - nouveau declencheur 'payment_received' (confirmations de paiement
--   personnalisees, appele par stripe-webhook apres marquage paye)
-- - payment_filter : 'any' (tout paiement), 'deposit' (premier paiement
--   rental du booking), 'final' (le paiement qui solde tout le sejour)

alter table public.email_rules drop constraint if exists email_rules_trigger_check;
alter table public.email_rules add constraint email_rules_trigger_check check (trigger in ('check_in', 'check_out', 'due_date', 'payment_received'));
alter table public.email_rules add column if not exists payment_filter text not null default 'any';
alter table public.email_rules drop constraint if exists email_rules_payment_filter_check;
alter table public.email_rules add constraint email_rules_payment_filter_check check (payment_filter in ('any', 'deposit', 'final'));
