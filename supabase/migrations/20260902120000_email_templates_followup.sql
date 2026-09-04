-- 2 sept 2026 : la demande de paiement se decline en DEUX templates editables
-- separement dans l'onglet Emails — 1er paiement (payment_request, "We're
-- happy to confirm your stay...") et paiements suivants
-- (payment_request_followup, "...is getting close"). Le choix se fait par
-- l'ordinal dans PaymentEmailDialog.
insert into public.email_templates (key, subject, body_top, body_bottom, body) values
(
  'payment_request_followup',
  'Your stay at Quinta do Amor — {{payment_or_final}}',
  E'Hi {{first_name}},\n\nI hope you''re doing well!\n\n{{stay_line}}\n\n{{payment_intro}}',
  E'Your invoice will arrive in your inbox as soon as the payment comes through.\n\nIf anything feels unclear, just reply to this email, I''m happy to help.\n\nLooking forward to welcoming you soon.\n\nWarmly,\nGeo',
  null
)
on conflict (key) do nothing;
