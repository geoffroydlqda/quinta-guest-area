// Templates des emails manuels (demande de paiement, confirmation) —
// 27 août 2026. Source de vérité : table `email_templates` (éditable depuis
// l'onglet Emails de l'admin) ; les valeurs ci-dessous sont les défauts
// (mêmes textes que le seed de la migration) et le repli hors-ligne.
//
// Les variables {{...}} sont rendues au moment de composer l'email dans
// PaymentEmailDialog : certaines sont de simples champs (first_name, amount),
// d'autres sont des blocs calculés (stay_line, payment_intro, settled_note)
// pour garder la logique conditionnelle (paiement groupé, dernier paiement…)
// hors du template.

export type ManualTemplateKey = "payment_request" | "payment_confirmation";

export type ManualTemplate = {
  subject: string;
  body_top: string | null;
  body_bottom: string | null;
  body: string | null;
};

export const DEFAULT_TEMPLATES: Record<ManualTemplateKey, ManualTemplate> = {
  payment_request: {
    subject: "Your stay at Quinta do Amor — {{payment_or_final}}",
    body_top:
`Hi {{first_name}},

I hope you're doing well!

{{stay_line}}

{{payment_intro}}`,
    body_bottom:
`Your invoice will arrive in your inbox as soon as the payment comes through.

If anything feels unclear, just reply to this email, I'm happy to help.

Looking forward to welcoming you soon.

Warmly,
Geo`,
    body: null,
  },
  payment_confirmation: {
    subject: "Payment received — you're all set",
    body_top: null,
    body_bottom: null,
    body:
`Hi {{first_name}},

Good news, your payment of {{amount}} has arrived safely.{{settled_note}}

If you have any questions at all, I'm always happy to help. Just reply here.

See you very soon at the Quinta.

Warmly,
Geo`,
  },
};

// Aide affichée dans l'éditeur de l'onglet Emails.
export const TEMPLATE_VARIABLES: Record<ManualTemplateKey, { name: string; hint: string }[]> = {
  payment_request: [
    { name: "first_name", hint: "guest first name (\"there\" fallback)" },
    { name: "stay_line", hint: "1st payment: \"We're delighted to confirm your stay…\" · later payments: \"Your stay … is getting close\"" },
    { name: "payment_intro", hint: "\"Here's the link for the second and final payment…\" or the grouped recap" },
    { name: "amount", hint: "total of the requested payment(s)" },
    { name: "payment_or_final", hint: "\"payment\" or \"final payment\"" },
    { name: "retreat_name", hint: "event name" },
    { name: "check_in_date", hint: "check-in date" },
    { name: "check_out_date", hint: "check-out date" },
  ],
  payment_confirmation: [
    { name: "first_name", hint: "guest first name" },
    { name: "amount", hint: "amount received" },
    { name: "settled_note", hint: "\" Your stay is now fully settled.\" when everything is paid, empty otherwise" },
    { name: "retreat_name", hint: "event name" },
  ],
};

export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}
