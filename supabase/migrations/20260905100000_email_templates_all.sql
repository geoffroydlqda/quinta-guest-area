-- Tous les emails guests deviennent editables dans l'onglet Emails
-- (4 sept 2026, demande Geoffroy) :
--  - nouveaux templates : invitation (send-invite-email), payment_reminder et
--    payment_reminder_overdue (rappel manuel de payment-reminders) ;
--  - "snippets" (phrases composees) : cles `snippet.<nom>` (subject vide,
--    texte dans body) — stay_line, payment_intro, caption Stripe,
--    "Where you stand", titre PAYMENT SCHEDULE, note catering, overview…
-- Les defauts vivent aussi dans src/lib/emailTemplates.ts (client) et dans les
-- Edge Functions (repli si la ligne disparait). on conflict do nothing : ne
-- jamais ecraser un texte deja edite par Geoffroy.

insert into public.email_templates (key, subject, body) values
('invitation', 'Your invitation to the Quinta do Amor Guest Area',
E'Hi {{first_name}},\n\nWe''re happy to support you in creating magical moments {{stay_line}}.\n\nYour personal Guest Area is ready. It''s where you can choose your room setup, plan your meals and arrange your transportation.\n\n[[button]]\n\nPlease let me know if you have any questions!\n\nGeo\nQuinta do Amor'),
('payment_reminder', 'Payment reminder — {{label}} — Quinta do Amor',
E'Hi {{first_name}},\n\nThis is a friendly reminder that the payment below is due on {{due_date}}.\n\n[[details]]\n\n[[button]]\n\nYou can review your payment details anytime in your Guest Area.\n\nIf you have already made this payment, please disregard this message — it can take us a little time to reconcile transfers.\n\nWarm regards,\nQuinta do Amor'),
('payment_reminder_overdue', 'Payment follow-up — {{label}} — Quinta do Amor',
E'Hi {{first_name}},\n\nThis is a friendly follow-up: the payment below was due on {{due_date}} and is still marked as pending.\n\n[[details]]\n\n[[button]]\n\nYou can review your payment details anytime in your Guest Area.\n\nIf you have already made this payment, please disregard this message — it can take us a little time to reconcile transfers.\n\nWarm regards,\nQuinta do Amor')
on conflict (key) do nothing;

insert into public.email_templates (key, subject, body) values
('snippet.stay_line_first', '', E'We''re happy to confirm your stay at Quinta do Amor from {{stay_range}}'),
('snippet.stay_line_followup', '', E'Your stay at Quinta do Amor from {{stay_range}} is getting close'),
('snippet.payment_intro_single', '', E'Here''s the link for the {{ordinal}}{{and_final}} payment for your stay:'),
('snippet.payment_intro_grouped', '', E'Here''s a quick recap of the payments for your stay:\n\n{{payment_list}}\n\nYou can settle everything in one go with the link below:'),
('snippet.settled_note', '', 'Your stay is now fully settled.'),
('snippet.stripe_caption', '', 'Secure bank payment (debit or transfer), powered by Stripe.'),
('snippet.stripe_caption_attached', '', 'The full details of this payment are attached.'),
('snippet.recap_line', '', 'Where you stand: {{parts}}.'),
('snippet.recap_already_received', '', '{{amount}} already received'),
('snippet.recap_this_payment', '', 'this payment {{amount}}'),
('snippet.recap_remaining', '', '{{amount}} will remain for later'),
('snippet.recap_settled_after', '', 'after it, your stay is fully settled'),
('snippet.schedule_title', '', 'PAYMENT SCHEDULE'),
('snippet.schedule_catering_note', '', 'Catering & extras are invoiced separately, one week before check-in.'),
('snippet.overview_line', '', 'Payment overview: {{paid}} received of {{total}}'),
('snippet.overview_remaining', '', '{{amount}} remaining'),
('snippet.overview_settled', '', 'your stay is fully settled')
on conflict (key) do nothing;
