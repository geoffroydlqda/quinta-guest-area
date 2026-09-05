import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Mail, Quote, RotateCcw, Save, Send } from "lucide-react";
import {
  DEFAULT_TEMPLATES,
  SNIPPETS,
  TEMPLATE_VARIABLES,
  renderTemplate,
  snippetDbKey,
  type ManualTemplate,
  type ManualTemplateKey,
} from "@/lib/emailTemplates";

/**
 * Onglet Emails — TOUS les templates d'emails guests (4 sept 2026 : plus aucun
 * email non éditable). Demandes/confirmations de paiement, invitation guest
 * area, rappels manuels — plus la carte "Phrases" (EmailSnippetsCard) pour les
 * bouts de texte composés dynamiquement ({{stay_line}}, blocs serveur…).
 */

const META: Record<ManualTemplateKey, { title: string; note: string }> = {
  payment_request: {
    title: "Payment request — first payment",
    note: "Sent from a booking's Payments tab for the FIRST payment. The Pay button, the balance recap, the payment schedule and the pro forma PDF are inserted automatically between the two text parts.",
  },
  payment_request_followup: {
    title: "Payment request — follow-up (2nd payment onwards)",
    note: "Same mechanics, used for the second and later payments (the \"getting close\" one). Pay button, balance recap, schedule and pro forma inserted automatically.",
  },
  payment_confirmation: {
    title: "Payment confirmation — automatic after each Stripe payment (and manual ✉️)",
    note: "This exact template is what a guest receives automatically when their Stripe payment arrives (invoice PDF attached), and what the manual ✉️ button pre-fills. If an active payment-received rule exists in Automatic emails, that rule replaces this one — the guest never gets both.",
  },
  invitation: {
    title: "Guest Area invitation",
    note: "Sent from the Bookings tab (Mail button) — you can still tweak each email in the pop-up before sending. [[button]] marks where the \"Open my Guest Area\" button and fallback link go; if you delete it, it is re-added at the end (the link must always be included).",
  },
  payment_reminder: {
    title: "Payment reminder — upcoming payment",
    note: "Sent from the Payments page reminder button when the installment is not yet due. [[details]] = the amount/due-date box, [[button]] = the Pay now button (only when the installment has a payment link).",
  },
  payment_reminder_overdue: {
    title: "Payment reminder — overdue payment",
    note: "Same mechanics, used when the installment's due date has passed.",
  },
};

// "Send me a test" n'existe que pour les 3 templates de paiement (rendus par
// payment-emails) ; invitation et rappels se relisent via leur pop-up d'envoi.
const TESTABLE: ManualTemplateKey[] = ["payment_request", "payment_request_followup", "payment_confirmation"];

function VariablesHelp({ tplKey }: { tplKey: ManualTemplateKey }) {
  // Chaque variable avec un exemple CONCRET visible (demande Geoffroy, 4 sept
  // 2026 — "il faut que je comprenne {{stay_line}} quand je le vois").
  return (
    <div className="rounded-lg bg-muted/40 border border-border px-3 py-2 space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">Variables — replaced automatically at send time:</div>
      {TEMPLATE_VARIABLES[tplKey].map((v) => (
        <div key={v.name} className="text-[11px] leading-snug">
          <code className="text-foreground bg-background border border-border rounded px-1 py-px">{`{{${v.name}}}`}</code>
          <span className="text-muted-foreground"> → e.g. </span>
          <span className="text-foreground/80 italic">“{v.example.trim()}”</span>
          <span className="text-muted-foreground"> — {v.hint}</span>
        </div>
      ))}
      <div className="text-[11px] text-muted-foreground pt-0.5">Signature (site, phone, links) added automatically on payment emails.</div>
    </div>
  );
}

function TemplateEditor({ tplKey }: { tplKey: ManualTemplateKey }) {
  const { toast } = useToast();
  const def = DEFAULT_TEMPLATES[tplKey];
  const isRequest = tplKey === "payment_request" || tplKey === "payment_request_followup";
  const [subject, setSubject] = useState(def.subject);
  const [bodyTop, setBodyTop] = useState(def.body_top ?? "");
  const [bodyBottom, setBodyBottom] = useState(def.body_bottom ?? "");
  const [body, setBody] = useState(def.body ?? "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [testing, setTesting] = useState(false);
  // Test : rend le template SAUVÉ avec des données d'exemple et l'envoie à
  // l'admin connecté (bouton Pay factice, échéancier d'exemple).
  const sendTest = async () => {
    setTesting(true);
    try {
      if (dirty) await save();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("No admin email");
      const { data, error } = await supabase.functions.invoke("payment-emails", {
        body: { test_template: { key: tplKey, to: user.email } },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast({ title: "Test sent", description: `Check ${user.email} — subject starts with [TEST].` });
    } catch (e) {
      toast({ title: "Test failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setTesting(false); }
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("email_templates")
        .select("subject,body_top,body_bottom,body").eq("key", tplKey).maybeSingle();
      if (data) {
        setSubject(data.subject);
        setBodyTop(data.body_top ?? "");
        setBodyBottom(data.body_bottom ?? "");
        setBody(data.body ?? "");
      }
      setLoading(false);
    })();
  }, [tplKey]);

  const save = async (values?: Partial<ManualTemplate>) => {
    setSaving(true);
    const payload = {
      key: tplKey,
      subject: values?.subject ?? subject,
      body_top: isRequest ? (values?.body_top ?? bodyTop) : null,
      body_bottom: isRequest ? (values?.body_bottom ?? bodyBottom) : null,
      body: isRequest ? null : (values?.body ?? body),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("email_templates").upsert(payload, { onConflict: "key" });
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Template saved" }); setDirty(false); }
    setSaving(false);
  };

  const resetToDefault = async () => {
    setSubject(def.subject);
    setBodyTop(def.body_top ?? "");
    setBodyBottom(def.body_bottom ?? "");
    setBody(def.body ?? "");
    await save({ subject: def.subject, body_top: def.body_top, body_bottom: def.body_bottom, body: def.body });
  };

  const mark = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setDirty(true); };

  if (loading) return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-medium text-sm">{META[tplKey].title}</div>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">{META[tplKey].note}</p>
        </div>
        <div className="flex gap-2">
          {TESTABLE.includes(tplKey) && (
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={sendTest} disabled={testing || saving}
              title="Send this template to your own inbox with sample data (saves your edits first)">
              {testing ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}
              Send me a test
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={resetToDefault} disabled={saving}
            title="Restore the original wording">
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={() => save()} disabled={saving || !dirty || !subject.trim()}>
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
            Save
          </Button>
        </div>
      </div>

      <label className="block space-y-1">
        <div className="text-xs text-muted-foreground">Subject</div>
        <Input value={subject} onChange={(e) => mark(setSubject)(e.target.value)} />
      </label>

      {isRequest ? (
        <>
          <label className="block space-y-1">
            <div className="text-xs text-muted-foreground">Text above the Pay button</div>
            <Textarea value={bodyTop} onChange={(e) => mark(setBodyTop)(e.target.value)} rows={7} />
          </label>
          <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            Pay button + "Secure bank payment…" line + "Where you stand" recap + payment schedule + pro forma PDF —
            inserted here automatically (wording editable in the Phrases tab).
          </div>
          <label className="block space-y-1">
            <div className="text-xs text-muted-foreground">Text below the Pay button</div>
            <Textarea value={bodyBottom} onChange={(e) => mark(setBodyBottom)(e.target.value)} rows={7} />
          </label>
        </>
      ) : (
        <label className="block space-y-1">
          <div className="text-xs text-muted-foreground">Body</div>
          <Textarea value={body} onChange={(e) => mark(setBody)(e.target.value)} rows={10} />
        </label>
      )}

      <VariablesHelp tplKey={tplKey} />
    </div>
  );
}

export function ManualEmailTemplatesCard() {
  return (
    <section className="bg-card rounded-2xl border border-border p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Mail className="w-4 h-4 text-[#35532A]" /> Email templates
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Every email a guest can receive. Edit the wording here — for the emails sent manually you can still
          tweak each one individually before sending it.
        </p>
      </div>
      <TemplateEditor tplKey="payment_request" />
      <TemplateEditor tplKey="payment_request_followup" />
      <TemplateEditor tplKey="payment_confirmation" />
      <TemplateEditor tplKey="invitation" />
      <TemplateEditor tplKey="payment_reminder" />
      <TemplateEditor tplKey="payment_reminder_overdue" />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Carte "Phrases" — les bouts de texte composés dynamiquement : ce qui remplit
// {{stay_line}}, {{payment_intro}}, {{settled_note}} et les blocs insérés côté
// serveur (caption Stripe, "Where you stand", échéancier, overview). Chaque
// phrase montre un exemple rendu en direct avec des valeurs types.
// ---------------------------------------------------------------------------
function SnippetRow({ snipKey, saved, onSaved }: { snipKey: string; saved: string | null; onSaved: (v: string | null) => void }) {
  const { toast } = useToast();
  const def = SNIPPETS[snipKey];
  const [text, setText] = useState(saved ?? def.text);
  const [saving, setSaving] = useState(false);
  const dirty = text !== (saved ?? def.text);
  const multiline = def.text.includes("\n");

  const exampleVars = useMemo(
    () => Object.fromEntries(def.vars.map((v) => [v.name, v.example])),
    [def],
  );

  const persist = async (value: string) => {
    setSaving(true);
    const { error } = await supabase.from("email_templates").upsert({
      key: snippetDbKey(snipKey), subject: "", body: value, updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Phrase saved" }); onSaved(value); }
    setSaving(false);
  };

  return (
    <div className="rounded-xl border border-border p-3.5 space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-medium text-[13px]">{def.label}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5 max-w-xl">{def.note}</p>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled={saving || text === def.text}
            onClick={() => { setText(def.text); void persist(def.text); }} title="Restore the original wording">
            <RotateCcw className="w-3 h-3 mr-1" /> Reset
          </Button>
          <Button size="sm" className="h-7 text-[11px]" onClick={() => persist(text)} disabled={saving || !dirty || !text.trim()}>
            {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
            Save
          </Button>
        </div>
      </div>
      {multiline
        ? <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} className="text-[13px]" />
        : <Input value={text} onChange={(e) => setText(e.target.value)} className="text-[13px]" />}
      <div className="text-[11px] text-muted-foreground whitespace-pre-wrap">
        <span className="font-medium">Example:</span>{" "}
        <span className="italic text-foreground/80">“{renderTemplate(text, exampleVars).trim()}”</span>
        {def.vars.length > 0 && (
          <span> — with {def.vars.map((v, i) => (
            <span key={v.name}>{i > 0 ? ", " : ""}<code className="bg-muted border border-border rounded px-1 py-px not-italic">{`{{${v.name}}}`}</code> = “{v.example.trim()}”</span>
          ))}</span>
        )}
      </div>
    </div>
  );
}

export function EmailSnippetsCard() {
  const [rows, setRows] = useState<Record<string, string | null> | null>(null);
  useEffect(() => {
    supabase.from("email_templates").select("key,body").like("key", "snippet.%")
      .then(({ data }) => {
        const m: Record<string, string | null> = {};
        for (const k of Object.keys(SNIPPETS)) m[k] = null;
        for (const r of data ?? []) {
          const k = r.key.replace(/^snippet\./, "");
          if (k in SNIPPETS && r.body != null && r.body.trim()) m[k] = r.body;
        }
        setRows(m);
      });
  }, []);
  if (!rows) return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
  return (
    <section className="bg-card rounded-2xl border border-border p-6 space-y-3">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Quote className="w-4 h-4 text-[#35532A]" /> Phrases &amp; building blocks
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          The dynamic bits of text used inside the templates: what fills <code className="bg-muted border border-border rounded px-1 py-px">{"{{stay_line}}"}</code>,{" "}
          <code className="bg-muted border border-border rounded px-1 py-px">{"{{payment_intro}}"}</code> and the blocks inserted automatically in payment emails
          (Pay-button caption, balance recap, payment schedule, confirmation footer). Edit the fixed words — the{" "}
          <code className="bg-muted border border-border rounded px-1 py-px">{"{{variables}}"}</code> are filled in at send time.
        </p>
      </div>
      {Object.keys(SNIPPETS).map((k) => (
        <SnippetRow key={k} snipKey={k} saved={rows[k]}
          onSaved={(v) => setRows((prev) => ({ ...(prev ?? {}), [k]: v }))} />
      ))}
    </section>
  );
}
