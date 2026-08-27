import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Mail, RotateCcw, Save } from "lucide-react";
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_VARIABLES,
  type ManualTemplate,
  type ManualTemplateKey,
} from "@/lib/emailTemplates";

/**
 * Onglet Emails — templates des emails MANUELS (27 août 2026) :
 * demande de paiement (avec bouton Pay + pro forma PDF automatiques) et
 * confirmation de paiement par défaut. Édités ici, ils sont utilisés tels
 * quels par la fenêtre d'envoi de la fiche booking (et restent modifiables
 * au cas par cas juste avant l'envoi).
 */

const META: Record<ManualTemplateKey, { title: string; note: string }> = {
  payment_request: {
    title: "Payment request",
    note: "Sent from a booking's Payments tab. The Pay button and the pro forma PDF (payment details + schedule) are inserted automatically between the two text parts.",
  },
  payment_confirmation: {
    title: "Payment confirmation (default)",
    note: "Used when you send a confirmation manually, and by the automatic post-payment email when no custom rule matches. The invoice PDF is attached automatically.",
  },
};

function TemplateEditor({ tplKey }: { tplKey: ManualTemplateKey }) {
  const { toast } = useToast();
  const def = DEFAULT_TEMPLATES[tplKey];
  const isRequest = tplKey === "payment_request";
  const [subject, setSubject] = useState(def.subject);
  const [bodyTop, setBodyTop] = useState(def.body_top ?? "");
  const [bodyBottom, setBodyBottom] = useState(def.body_bottom ?? "");
  const [body, setBody] = useState(def.body ?? "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

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
            Pay button + "Secure bank payment…" line + pro forma PDF — inserted here automatically.
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

      <div className="text-[11px] text-muted-foreground">
        Variables:{" "}
        {TEMPLATE_VARIABLES[tplKey].map((v, i) => (
          <span key={v.name} title={v.hint} className="cursor-help underline decoration-dotted">
            {i > 0 ? " " : ""}{`{{${v.name}}}`}
          </span>
        ))}
        {" "}— hover for details. Signature (site, phone, links) added automatically.
      </div>
    </div>
  );
}

export function ManualEmailTemplatesCard() {
  return (
    <section className="bg-card rounded-2xl border border-border p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Mail className="w-4 h-4 text-[#35532A]" /> Manual email templates
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          The emails you send yourself from a booking (payment request, confirmation). Edit the wording here —
          you can still tweak each email individually before sending it.
        </p>
      </div>
      <TemplateEditor tplKey="payment_request" />
      <TemplateEditor tplKey="payment_confirmation" />
    </section>
  );
}
