// Templates de TOUS les emails guests (4 sept 2026 — demande Geoffroy : plus
// aucun email non éditable). Source de vérité : table `email_templates`
// (éditable depuis l'onglet Emails de l'admin) ; les valeurs ci-dessous sont
// les défauts (mêmes textes que le seed des migrations) et le repli hors-ligne.
//
// Deux niveaux d'édition :
//  - les TEMPLATES (sujet + corps) : payment_request, payment_request_followup,
//    payment_confirmation, invitation, payment_reminder, payment_reminder_overdue ;
//  - les SNIPPETS (« phrases ») : les bouts de texte composés dynamiquement qui
//    remplissent les variables {{stay_line}}, {{payment_intro}}… et les blocs
//    insérés côté serveur (caption Stripe, "Where you stand", échéancier…).
//    Stockés dans la même table sous les clés `snippet.<nom>` (subject vide,
//    texte dans `body`).
//
// Les variables {{...}} sont rendues au moment de composer l'email
// (PaymentEmailDialog côté client, payment-emails / send-invite-email /
// payment-reminders côté serveur — les fonctions dupliquent ces défauts).

export type ManualTemplateKey =
  | "payment_request"
  | "payment_request_followup"
  | "payment_confirmation"
  | "invitation"
  | "payment_reminder"
  | "payment_reminder_overdue";

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
  // 2e paiement et suivants (ordinal > 1) — même structure, ton "getting
  // close". Éditable séparément du 1er dans l'onglet Emails (2 sept 2026).
  payment_request_followup: {
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
  // Email d'invitation à la guest area (bouton Mail de l'onglet Bookings).
  // [[button]] = position du bouton « Open my Guest Area » + lien de secours ;
  // il est réinséré en fin d'email s'il est supprimé (le lien doit toujours partir).
  invitation: {
    subject: "Your invitation to the Quinta do Amor Guest Area",
    body_top: null,
    body_bottom: null,
    body:
`Hi {{first_name}},

We're happy to support you in creating magical moments {{stay_line}}.

Your personal Guest Area is ready. It's where you can choose your room setup, plan your meals and arrange your transportation.

[[button]]

Please let me know if you have any questions!

Geo
Quinta do Amor`,
  },
  // Rappel de paiement MANUEL (bouton rappel de la page Payments) — échéance à
  // venir. [[details]] = encadré montant/date ; [[button]] = bouton Pay now
  // (seulement si un lien de paiement existe sur l'échéance).
  payment_reminder: {
    subject: "Payment reminder — {{label}} — Quinta do Amor",
    body_top: null,
    body_bottom: null,
    body:
`Hi {{first_name}},

This is a friendly reminder that the payment below is due on {{due_date}}.

[[details]]

[[button]]

You can review your payment details anytime in your Guest Area.

If you have already made this payment, please disregard this message — it can take us a little time to reconcile transfers.

Warm regards,
Quinta do Amor`,
  },
  // Rappel de paiement MANUEL — échéance en retard.
  payment_reminder_overdue: {
    subject: "Payment follow-up — {{label}} — Quinta do Amor",
    body_top: null,
    body_bottom: null,
    body:
`Hi {{first_name}},

This is a friendly follow-up: the payment below was due on {{due_date}} and is still marked as pending.

[[details]]

[[button]]

You can review your payment details anytime in your Guest Area.

If you have already made this payment, please disregard this message — it can take us a little time to reconcile transfers.

Warm regards,
Quinta do Amor`,
  },
};

// ---------------------------------------------------------------------------
// SNIPPETS (« phrases ») — les textes composés dynamiquement. Chaque entrée est
// éditable dans l'onglet Emails ; `vars` donne un exemple concret par variable
// pour l'aperçu. Clé en base : `snippet.<clé ci-dessous>`.
// ---------------------------------------------------------------------------
export type SnippetDef = {
  label: string;
  note: string;
  text: string;
  vars: { name: string; example: string }[];
};

export const SNIPPETS: Record<string, SnippetDef> = {
  stay_line_first: {
    label: "Stay line — first payment",
    note: "Becomes {{stay_line}} in the FIRST payment request. If the booking has no dates yet, \"from {{stay_range}}\" is dropped.",
    text: "We're happy to confirm your stay at Quinta do Amor from {{stay_range}}",
    vars: [{ name: "stay_range", example: "June 4 to 10" }],
  },
  stay_line_followup: {
    label: "Stay line — follow-up payments",
    note: "Becomes {{stay_line}} in the 2nd-and-later payment requests.",
    text: "Your stay at Quinta do Amor from {{stay_range}} is getting close",
    vars: [{ name: "stay_range", example: "June 4 to 10" }],
  },
  payment_intro_single: {
    label: "Payment intro — single payment",
    note: "Becomes {{payment_intro}} when one installment is requested.",
    text: "Here's the link for the {{ordinal}}{{and_final}} payment for your stay:",
    vars: [
      { name: "ordinal", example: "second" },
      { name: "and_final", example: " and final" },
    ],
  },
  payment_intro_grouped: {
    label: "Payment intro — grouped payments",
    note: "Becomes {{payment_intro}} when several installments share one link. {{payment_list}} is the \"– Deposit: €X (due …)\" lines.",
    text: `Here's a quick recap of the payments for your stay:

{{payment_list}}

You can settle everything in one go with the link below:`,
    vars: [{ name: "payment_list", example: "– Deposit: €4,170.00 (due 31 July 2026)\n– Final payment: €5,560.00 (due 4 May 2027)" }],
  },
  settled_note: {
    label: "Fully settled note",
    note: "Becomes {{settled_note}} in the confirmation when nothing remains to pay (empty otherwise).",
    text: "Your stay is now fully settled.",
    vars: [],
  },
  stripe_caption: {
    label: "Caption under the Pay button",
    note: "Small grey line right under the Pay button of every payment request.",
    text: "Secure bank payment (debit or transfer), powered by Stripe.",
    vars: [],
  },
  stripe_caption_attached: {
    label: "Caption — PDF attached",
    note: "Appended to the caption when the pro forma PDF is attached.",
    text: "The full details of this payment are attached.",
    vars: [],
  },
  recap_line: {
    label: "\"Where you stand\" line",
    note: "Balance recap under the Pay button. {{parts}} = the pieces below, joined by \" · \".",
    text: "Where you stand: {{parts}}.",
    vars: [{ name: "parts", example: "€4,170.00 already received · this payment €4,170.00 · €5,560.00 will remain for later" }],
  },
  recap_already_received: {
    label: "Recap — already received",
    note: "Shown only when something was already paid.",
    text: "{{amount}} already received",
    vars: [{ name: "amount", example: "€4,170.00" }],
  },
  recap_this_payment: {
    label: "Recap — this payment",
    note: "Always shown.",
    text: "this payment {{amount}}",
    vars: [{ name: "amount", example: "€4,170.00" }],
  },
  recap_remaining: {
    label: "Recap — remaining later",
    note: "Shown when something remains after this payment.",
    text: "{{amount}} will remain for later",
    vars: [{ name: "amount", example: "€5,560.00" }],
  },
  recap_settled_after: {
    label: "Recap — settled after this payment",
    note: "Shown instead of the remaining amount when this payment settles the stay.",
    text: "after it, your stay is fully settled",
    vars: [],
  },
  schedule_title: {
    label: "Payment schedule title",
    note: "Heading of the bordered schedule box in payment requests.",
    text: "PAYMENT SCHEDULE",
    vars: [],
  },
  schedule_catering_note: {
    label: "Catering & extras note",
    note: "Shown under the schedule when the booking has no catering/extra/transport installments yet.",
    text: "Catering & extras are invoiced separately, one week before check-in.",
    vars: [],
  },
  overview_line: {
    label: "\"Payment overview\" line (confirmations)",
    note: "Grey footer of every confirmation email. \" · {{remaining}} remaining\" or \" — fully settled\" is appended.",
    text: "Payment overview: {{paid}} received of {{total}}",
    vars: [
      { name: "paid", example: "€8,340.00" },
      { name: "total", example: "€13,900.00" },
    ],
  },
  overview_remaining: {
    label: "Overview — remaining",
    note: "Appended after \" · \" when something remains to pay.",
    text: "{{amount}} remaining",
    vars: [{ name: "amount", example: "€5,560.00" }],
  },
  overview_settled: {
    label: "Overview — fully settled",
    note: "Appended after \" — \" when the stay is fully paid.",
    text: "your stay is fully settled",
    vars: [],
  },
};

export const snippetDbKey = (k: string) => `snippet.${k}`;

/** Textes des snippets : version éditée en base si elle existe, défaut sinon. */
export function mergeSnippets(rows: { key: string; body: string | null }[] | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(SNIPPETS)) out[k] = SNIPPETS[k].text;
  for (const r of rows ?? []) {
    const k = r.key.replace(/^snippet\./, "");
    if (r.body != null && r.body.trim() && k in SNIPPETS) out[k] = r.body;
  }
  return out;
}

// Aide affichée dans l'éditeur de l'onglet Emails — chaque variable vient avec
// un EXEMPLE concret (demande Geoffroy, 4 sept 2026).
export type TemplateVarHelp = { name: string; hint: string; example: string };

const REQUEST_VARS: TemplateVarHelp[] = [
  { name: "first_name", hint: "guest first name (\"there\" fallback)", example: "Alex" },
  { name: "stay_line", hint: "editable phrase (see Phrases below): confirm on the 1st payment, \"getting close\" on later ones", example: "We're happy to confirm your stay at Quinta do Amor from June 4 to 10" },
  { name: "payment_intro", hint: "editable phrase (see Phrases below): single link or grouped recap", example: "Here's the link for the second and final payment for your stay:" },
  { name: "amount", hint: "total of the requested payment(s)", example: "€4,170.00" },
  { name: "payment_or_final", hint: "\"payment\" or \"final payment\"", example: "final payment" },
  { name: "retreat_name", hint: "event name", example: "Root to Rise Retreat" },
  { name: "check_in_date", hint: "check-in date", example: "2027-06-04" },
  { name: "check_out_date", hint: "check-out date", example: "2027-06-10" },
];

export const TEMPLATE_VARIABLES: Record<ManualTemplateKey, TemplateVarHelp[]> = {
  payment_request: REQUEST_VARS,
  payment_request_followup: REQUEST_VARS,
  payment_confirmation: [
    { name: "first_name", hint: "guest first name", example: "Alex" },
    { name: "amount", hint: "amount received", example: "€4,170.00" },
    { name: "settled_note", hint: "editable phrase (see Phrases below) when everything is paid, empty otherwise", example: " Your stay is now fully settled." },
    { name: "retreat_name", hint: "event name", example: "Root to Rise Retreat" },
  ],
  invitation: [
    { name: "first_name", hint: "guest first name (\"there\" fallback)", example: "Alex" },
    { name: "stay_line", hint: "\"at Quinta do Amor from X to Y\" (adapts to missing dates)", example: "at Quinta do Amor from 4 to 10 June 2027" },
    { name: "retreat_name", hint: "event name", example: "Root to Rise Retreat" },
  ],
  payment_reminder: [
    { name: "first_name", hint: "guest first name (\"there\" fallback)", example: "Alex" },
    { name: "label", hint: "installment label", example: "Final payment" },
    { name: "amount", hint: "amount due", example: "€5,560.00" },
    { name: "due_date", hint: "due date of the installment", example: "2027-05-04" },
  ],
  payment_reminder_overdue: [
    { name: "first_name", hint: "guest first name (\"there\" fallback)", example: "Alex" },
    { name: "label", hint: "installment label", example: "Final payment" },
    { name: "amount", hint: "amount due", example: "€5,560.00" },
    { name: "due_date", hint: "due date of the installment", example: "2027-05-04" },
  ],
};

export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}
