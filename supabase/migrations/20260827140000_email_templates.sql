-- 27 aout 2026 — templates des emails manuels (demande de paiement,
-- confirmation) editables depuis l'onglet Emails de l'admin.
-- Les variables {{...}} sont rendues au moment de composer l'email :
-- first_name, stay_line, payment_intro, amount, payment_or_final,
-- settled_note, retreat_name, check_in_date, check_out_date.
create table public.email_templates (
  key text primary key,
  subject text not null,
  body_top text,
  body_bottom text,
  body text,
  updated_at timestamptz not null default now()
);

alter table public.email_templates enable row level security;
revoke all on public.email_templates from anon;

create policy "Admins manage email templates" on public.email_templates
  for all using (is_admin()) with check (is_admin());

insert into public.email_templates (key, subject, body_top, body_bottom, body) values
(
  'payment_request',
  'Your stay at Quinta do Amor — {{payment_or_final}}',
  E'Hi {{first_name}},\n\nI hope you''re doing well!\n\n{{stay_line}}\n\n{{payment_intro}}',
  E'Your invoice will arrive in your inbox as soon as the payment comes through.\n\nIf anything feels unclear, just reply to this email, I''m happy to help.\n\nLooking forward to welcoming you soon.\n\nWarmly,\nGeo',
  null
),
(
  'payment_confirmation',
  E'Payment received — you''re all set',
  null,
  null,
  E'Hi {{first_name}},\n\nGood news, your payment of {{amount}} has arrived safely.{{settled_note}}\n\nIf you have any questions at all, I''m always happy to help. Just reply here.\n\nSee you very soon at the Quinta.\n\nWarmly,\nGeo'
);
