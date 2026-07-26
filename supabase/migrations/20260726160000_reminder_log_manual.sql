-- Page Payments : rappels manuels par échéance.
-- 1) Nouveau type 'payment_manual' dans reminder_log (bouton "Send reminder").
-- 2) Le dédoublonnage "une fois par (type, échéance)" ne s'applique qu'aux
--    envois AUTOMATIQUES — un rappel manuel peut être renvoyé plusieurs fois.
alter table public.reminder_log drop constraint if exists reminder_log_type_check;
alter table public.reminder_log add constraint reminder_log_type_check
  check (type in ('payment_upcoming', 'payment_overdue', 'payment_manual', 'invitation'));

drop index if exists public.reminder_log_payment_dedupe;
create unique index if not exists reminder_log_payment_dedupe
  on public.reminder_log (type, installment_id)
  where status = 'sent' and installment_id is not null
    and type in ('payment_upcoming', 'payment_overdue');
