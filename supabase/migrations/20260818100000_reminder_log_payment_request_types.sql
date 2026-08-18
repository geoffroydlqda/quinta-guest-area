-- payment-emails journalise type='payment_request'/'payment_receipt' mais la
-- contrainte CHECK ne les autorisait pas : chaque insert echouait EN SILENCE
-- (erreur non verifiee dans la fonction) -> aucun envoi de demande/confirmation
-- de paiement n'a jamais ete journalise, et la mention "Payment email sent"
-- ne pouvait pas s'afficher pour ces envois. On elargit la contrainte.
alter table public.reminder_log drop constraint reminder_log_type_check;
alter table public.reminder_log add constraint reminder_log_type_check
  check (type = any (array[
    'payment_upcoming'::text, 'payment_overdue'::text, 'payment_manual'::text,
    'payment_request'::text, 'payment_receipt'::text, 'invitation'::text
  ]));
