import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Mail, Paperclip, X } from "lucide-react";
import { DEFAULT_TEMPLATES, renderTemplate, type ManualTemplateKey } from "@/lib/emailTemplates";

/**
 * Compose éditable des emails de paiement (textes validés par Geoffroy).
 * - kind "request" : demande de paiement, bouton Pay €X inséré entre les deux
 *   zones de texte (lien signé généré côté serveur, toujours valable).
 * - kind "confirmation" : paiement reçu, fatura-recibo en pièce jointe.
 * L'envoi part via l'Edge Function payment-emails (Resend, hello@quintamor.com,
 * Helvetica 12).
 */

export type EmailBooking = {
  email: string;
  first_name?: string | null;
  retreat_name?: string | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
};

export type EmailInstallment = {
  id: string;
  label?: string | null;
  amount_due: number;
  due_date?: string | null;
  invoice_file_url?: string | null;
  invoice_file_name?: string | null;
};

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth"];
const ordinalWord = (n: number) => ORDINALS[n - 1] ?? `${n}th`;

const fmtEur = (n: number) => `€${Number(n).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;

function stayRange(checkIn?: string | null, checkOut?: string | null): string | null {
  if (!checkIn || !checkOut) return null;
  const a = new Date(`${checkIn}T12:00:00`);
  const b = new Date(`${checkOut}T12:00:00`);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  const mA = a.toLocaleDateString("en-GB", { month: "long" });
  const mB = b.toLocaleDateString("en-GB", { month: "long" });
  return mA === mB
    ? `${mA} ${a.getDate()} to ${b.getDate()}`
    : `${mA} ${a.getDate()} to ${mB} ${b.getDate()}`;
}

// Date d'échéance côté guest : nom du mois en toutes lettres (lisible US + EU).
const fmtDue = (d?: string | null): string | null => {
  if (!d) return null;
  const dt = new Date(`${d}T12:00:00`);
  if (isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
};

// Valeurs des variables {{...}} du template "payment_request" — la logique
// conditionnelle (groupé, dernier paiement…) vit ici, le texte dans la table
// email_templates (éditable depuis l'onglet Emails).
export function requestTemplateVars(booking: EmailBooking, inst: EmailInstallment, ordinal: number, isLast: boolean, groupInsts: EmailInstallment[] = []): Record<string, string> {
  const stay = stayRange(booking.check_in_date, booking.check_out_date);
  const grouped = groupInsts.length > 1;
  const total = (grouped ? groupInsts : [inst]).reduce((s, i) => s + Number(i.amount_due || 0), 0);
  const paymentIntro = grouped
    ? `Here's a quick recap of the payments for your stay:

${[...groupInsts]
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))
    .map((i) => {
      const due = fmtDue(i.due_date);
      return `– ${i.label || "Payment"}: ${fmtEur(Number(i.amount_due))}${due ? ` (due ${due})` : ""}`;
    }).join("\n")}

You can settle everything in one go with the link below:`
    : `Here's the link for the ${ordinalWord(ordinal)}${isLast ? " and final" : ""} payment for your stay:`;
  return {
    first_name: (booking.first_name ?? "").trim() || "there",
    // "is getting close" n'a de sens que pour le 2e paiement / solde (70 %) —
    // pour le 1er (acompte, souvent des mois avant), on confirme le séjour
    // (demande Geoffroy, 2 sept 2026).
    stay_line: ordinal > 1
      ? (stay
        ? `Your stay at Quinta do Amor from ${stay} is getting close`
        : `Your stay at Quinta do Amor is getting close`)
      : (stay
        ? `We're happy to confirm your stay at Quinta do Amor from ${stay}`
        : `We're happy to confirm your stay at Quinta do Amor`),
    payment_intro: paymentIntro,
    amount: fmtEur(total),
    payment_or_final: isLast ? "final payment" : "payment",
    retreat_name: booking.retreat_name ?? "",
    check_in_date: booking.check_in_date ?? "",
    check_out_date: booking.check_out_date ?? "",
  };
}

export function confirmationTemplateVars(booking: EmailBooking, inst: EmailInstallment, allSettled: boolean): Record<string, string> {
  return {
    first_name: (booking.first_name ?? "").trim() || "there",
    amount: fmtEur(Number(inst.amount_due)),
    settled_note: allSettled ? " Your stay is now fully settled." : "",
    retreat_name: booking.retreat_name ?? "",
  };
}

export function PaymentEmailDialog({
  open,
  onOpenChange,
  kind,
  booking,
  inst,
  ordinal,
  isLast,
  allSettled,
  groupInsts,
  onSent,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: "request" | "confirmation";
  booking: EmailBooking;
  inst: EmailInstallment;
  ordinal: number;
  isLast: boolean;
  allSettled: boolean;
  /** Demande groupée : plusieurs échéances -> un seul lien Stripe (une facture multi-lignes). */
  groupInsts?: EmailInstallment[];
  onSent?: () => void;
}) {
  const insts = kind === "request" && groupInsts && groupInsts.length > 1 ? groupInsts : [inst];
  const totalDue = insts.reduce((s, i) => s + Number(i.amount_due || 0), 0);
  const { toast } = useToast();
  // Adresses secondaires (client_profiles.cc_emails) : le serveur les met en
  // CC à l'envoi — on les AFFICHE ici pour que ce soit visible avant d'envoyer
  // (2 sept 2026 : Geoffroy croyait que l'email ne partait qu'au principal).
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  useEffect(() => {
    setCcEmails([]);
    const email = (booking.email ?? "").toLowerCase();
    if (!email) return;
    supabase.from("client_profiles").select("cc_emails").eq("email", email).maybeSingle()
      .then(({ data }) => {
        const cc = ((data?.cc_emails as string[] | null) ?? []).filter((e) => e && e.toLowerCase() !== email);
        setCcEmails(cc.slice(0, 5));
      });
  }, [booking.email]);
  const [subject, setSubject] = useState("");
  const [bodyTop, setBodyTop] = useState("");
  const [bodyBottom, setBodyBottom] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewingEmail, setPreviewingEmail] = useState(false);
  // Aperçu du mail complet (blocs serveur inclus : bouton, récap, échéancier)
  // dans un nouvel onglet — rien n'est envoyé.
  const previewEmail = async () => {
    setPreviewingEmail(true);
    try {
      const payload = kind === "request"
        ? (insts.length > 1
          ? { kind, installment_ids: insts.map((i) => i.id), subject, body_top: bodyTop, body_bottom: bodyBottom, preview_email: true }
          : { kind, installment_id: inst.id, subject, body_top: bodyTop, body_bottom: bodyBottom, preview_email: true })
        : { kind, installment_id: inst.id, subject, body, preview_email: true };
      const { data, error } = await supabase.functions.invoke("payment-emails", { body: payload });
      if (error || data?.error || !data?.html) throw new Error(data?.error || error?.message || "No preview returned");
      const banner = `<div style="position:sticky;top:0;background:#FDF1E0;color:#8A4A1B;font-family:Helvetica,Arial,sans-serif;font-size:12px;padding:8px 16px;border-bottom:1px solid #E3B48F;">PREVIEW — nothing has been sent. To: ${data.to}${(data.cc ?? []).length ? ` · CC: ${(data.cc as string[]).join(", ")}` : ""} · Subject: ${data.subject}${data.attachment ? ` · Attachment: ${data.attachment}` : ""}</div>`;
      // Charset UTF-8 obligatoire (2 sept 2026) : sans lui le blob s'ouvrait
      // en Latin-1 (â€", â,¬…). Le meta est injecté DANS le document et la
      // bannière juste après <body> pour garder un HTML valide.
      const withMeta = (data.html as string).replace("<html>", `<html><head><meta charset="utf-8"></head>`);
      const doc = withMeta.includes("<body")
        ? withMeta.replace(/<body([^>]*)>/, (_m, attrs) => `<body${attrs}>${banner}`)
        : `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0">${banner}${data.html}</body></html>`;
      const url = URL.createObjectURL(new Blob([doc], { type: "text/html;charset=utf-8" }));
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast({ title: "Preview failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setPreviewingEmail(false); }
  };

  // Ouvre le pro forma PDF (celui qui sera joint à l'email) dans un nouvel
  // onglet, sans rien envoyer — pour vérifier le contenu avant l'envoi.
  const previewProforma = async () => {
    setPreviewing(true);
    try {
      const payload = insts.length > 1
        ? { kind: "request", installment_ids: insts.map((i) => i.id), preview_proforma: true }
        : { kind: "request", installment_id: inst.id, preview_proforma: true };
      const { data, error } = await supabase.functions.invoke("payment-emails", { body: payload });
      if (error || data?.error || !data?.proforma) throw new Error(data?.error || error?.message || "No PDF returned");
      const bytes = Uint8Array.from(atob(data.proforma), (ch) => ch.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast({ title: "Preview failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  };
  // Pièces jointes libres (demande Geoffroy, 18 août 2026) — en plus de la
  // facture auto sur les confirmations. Encodées en base64 dans le payload.
  const [files, setFiles] = useState<File[]>([]);
  const attachRef = useRef<HTMLInputElement>(null);
  const MAX_TOTAL = 10 * 1024 * 1024; // 10 MB au total (limite raisonnable Resend/edge)
  const totalSize = files.reduce((s, f) => s + f.size, 0);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files, ...Array.from(list)];
    if (next.reduce((s, f) => s + f.size, 0) > MAX_TOTAL) {
      toast({ title: "Attachments too large", description: "Keep the total under 10 MB.", variant: "destructive" });
      return;
    }
    setFiles(next);
  };

  const fileToB64 = (f: File) => new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error(`Could not read ${f.name}`));
    r.readAsDataURL(f);
  });

  // (Re)charge le template à chaque ouverture : version éditée en base
  // (onglet Emails) si elle existe, défauts du code sinon.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      // 1er paiement et suivants : deux templates distincts (2 sept 2026)
      const key: ManualTemplateKey = kind === "request"
        ? (ordinal > 1 ? "payment_request_followup" : "payment_request")
        : "payment_confirmation";
      const { data } = await supabase.from("email_templates")
        .select("subject,body_top,body_bottom,body").eq("key", key).maybeSingle();
      if (cancelled) return;
      const tpl = data ?? DEFAULT_TEMPLATES[key];
      if (kind === "request") {
        const vars = requestTemplateVars(booking, inst, ordinal, isLast, insts);
        setSubject(renderTemplate(tpl.subject, vars));
        setBodyTop(renderTemplate(tpl.body_top ?? DEFAULT_TEMPLATES[key].body_top ?? "", vars));
        setBodyBottom(renderTemplate(tpl.body_bottom ?? DEFAULT_TEMPLATES[key].body_bottom ?? "", vars));
      } else {
        const vars = confirmationTemplateVars(booking, inst, allSettled);
        setSubject(renderTemplate(tpl.subject, vars));
        setBody(renderTemplate(tpl.body ?? DEFAULT_TEMPLATES.payment_confirmation.body ?? "", vars));
      }
    })();
    setFiles([]);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, inst.id]);

  const missingInvoice = kind === "confirmation" && !inst.invoice_file_url;

  const send = async () => {
    setSending(true);
    try {
      const attachments = files.length
        ? await Promise.all(files.map(async (f) => ({ filename: f.name, content: await fileToB64(f) })))
        : undefined;
      const payload = kind === "request"
        ? (insts.length > 1
          ? { kind, installment_ids: insts.map((i) => i.id), subject, body_top: bodyTop, body_bottom: bodyBottom, attachments }
          : { kind, installment_id: inst.id, subject, body_top: bodyTop, body_bottom: bodyBottom, attachments })
        : { kind, installment_id: inst.id, subject, body, attachments };
      const { data, error } = await supabase.functions.invoke("payment-emails", { body: payload });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast({
        title: "Email sent",
        description: `${kind === "request" ? "Payment request" : "Confirmation"} sent to ${booking.email}${data?.attachment ? ` · ${data.attachment} attached` : ""}.`,
      });
      onOpenChange(false);
      onSent?.();
    } catch (e) {
      toast({ title: "Send failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* max-h + scroll : le compose peut dépasser l'écran (récap + PJ) —
          sans ça le haut/bas du dialogue devenait inaccessible. */}
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-4 h-4" />
            {kind === "request" ? "Send payment request" : "Send payment confirmation"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="text-xs text-muted-foreground">
            To <span className="font-medium text-foreground">{booking.email}</span>
            {ccEmails.length > 0 && <> · CC <span className="font-medium text-foreground">{ccEmails.join(", ")}</span></>}
            {" "}· from hello@quintamor.com
          </div>

          <label className="block space-y-1">
            <div className="text-xs text-muted-foreground">Subject</div>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>

          {kind === "request" ? (
            <>
              <Textarea value={bodyTop} onChange={(e) => setBodyTop(e.target.value)} rows={7} className="font-normal" />
              <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2.5 text-sm">
                <span className="inline-block rounded-md bg-primary px-5 py-2 text-primary-foreground font-semibold">
                  Pay {fmtEur(totalDue)}
                </span>
                <div className="mt-1 text-xs text-muted-foreground">Secure bank payment (debit or transfer), powered by Stripe.</div>
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  Inserted automatically — opens a fresh Stripe checkout on every click.
                </div>
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  Also inserted here at send time: <b>balance recap</b> (paid / this payment / remaining) and the <b>payment schedule</b> of the stay (✓ paid · → this payment · ○ upcoming — with the catering &amp; extras note when none are scheduled yet).
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-muted-foreground">
                <Paperclip className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1">Attached automatically: payment details (pro forma PDF)</span>
                <Button type="button" size="sm" variant="outline" className="h-6 text-[11px] px-2"
                  onClick={previewProforma} disabled={previewing}>
                  {previewing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                  Preview PDF
                </Button>
              </div>
              <Textarea value={bodyBottom} onChange={(e) => setBodyBottom(e.target.value)} rows={8} />
            </>
          ) : (
            <>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={11} />
              <div className={`flex items-center gap-2 text-xs rounded-lg border p-2.5 ${missingInvoice ? "border-red-300 bg-red-50 text-red-800" : "border-border bg-muted/40 text-muted-foreground"}`}>
                <Paperclip className="w-3.5 h-3.5 shrink-0" />
                {missingInvoice
                  ? "No invoice on this payment yet — generate it first (Invoice button), then send this email."
                  : `Attached: ${inst.invoice_file_name ?? "invoice.pdf"}`}
              </div>
            </>
          )}
          {/* Pièces jointes libres */}
          <div className="space-y-1.5">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-xs rounded-lg border border-border bg-muted/40 px-2.5 py-1.5">
                <Paperclip className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate flex-1">{f.name}</span>
                <span className="text-muted-foreground shrink-0">{(f.size / 1024 / 1024).toFixed(f.size > 1024 * 1024 ? 1 : 2)} MB</span>
                <button type="button" className="p-0.5 rounded hover:bg-muted shrink-0"
                  onClick={() => setFiles((arr) => arr.filter((_, j) => j !== i))}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => attachRef.current?.click()}>
                <Paperclip className="w-3.5 h-3.5 mr-1" /> Attach a file
              </Button>
              {files.length > 0 && (
                <span className="text-[11px] text-muted-foreground">{(totalSize / 1024 / 1024).toFixed(1)} / 10 MB</span>
              )}
              <input ref={attachRef} type="file" multiple className="hidden"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </div>
          </div>
        </div>

        <div className="text-[11px] text-muted-foreground">
          Signature added automatically: www.quintamor.com · +351 931 377 682 · 📅 availabilities · 📸 venue photos
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button variant="outline" onClick={previewEmail} disabled={previewingEmail || sending || !subject.trim()}
            title="Open the exact rendered email (button, balance recap, schedule) in a new tab — nothing is sent">
            {previewingEmail ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
            Preview email
          </Button>
          <Button onClick={send} disabled={sending || missingInvoice || !subject.trim()}>
            {sending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Mail className="w-4 h-4 mr-1.5" />}
            Send
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
