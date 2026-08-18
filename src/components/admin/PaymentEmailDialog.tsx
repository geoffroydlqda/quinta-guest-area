import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Mail, Paperclip, X } from "lucide-react";

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

export function buildRequestTemplate(booking: EmailBooking, inst: EmailInstallment, ordinal: number, isLast: boolean, groupInsts: EmailInstallment[] = []) {
  const first = (booking.first_name ?? "").trim() || "there";
  const stay = stayRange(booking.check_in_date, booking.check_out_date);
  const stayLine = stay
    ? `Your stay at Quinta do Amor from ${stay} is getting close`
    : `Your stay at Quinta do Amor is getting close`;
  // Demande groupée : récap des échéances (montant + due date) dans le corps
  // du mail, triées par échéance — remplace l'ancienne phrase "One link, N
  // payments together" jugée peu claire (Geoffroy, 18 août 2026).
  const grouped = groupInsts.length > 1;
  const middle = grouped
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
    subject: `Your stay at Quinta do Amor — ${isLast ? "final payment" : "payment"}`,
    bodyTop:
`Hi ${first},

I hope you're doing well!

${stayLine}

${middle}`,
    bodyBottom:
`Your invoice will arrive in your inbox as soon as the payment comes through.

If anything feels unclear, just reply to this email, I'm happy to help.

Looking forward to welcoming you soon.

Warmly,
Geo`,
  };
}

export function buildConfirmationTemplate(booking: EmailBooking, inst: EmailInstallment, allSettled: boolean) {
  const first = (booking.first_name ?? "").trim() || "there";
  return {
    subject: "Payment received — you're all set",
    body:
`Hi ${first},

Good news, your payment of ${fmtEur(Number(inst.amount_due))} has arrived safely.${allSettled ? " Your stay is now fully settled." : ""}

If you have any questions at all, I'm always happy to help. Just reply here.

See you very soon at the Quinta.

Warmly,
Geo`,
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
  const [subject, setSubject] = useState("");
  const [bodyTop, setBodyTop] = useState("");
  const [bodyBottom, setBodyBottom] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
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

  // (Re)charge le template à chaque ouverture
  useEffect(() => {
    if (!open) return;
    if (kind === "request") {
      const t = buildRequestTemplate(booking, inst, ordinal, isLast, insts);
      setSubject(t.subject); setBodyTop(t.bodyTop); setBodyBottom(t.bodyBottom);
    } else {
      const t = buildConfirmationTemplate(booking, inst, allSettled);
      setSubject(t.subject); setBody(t.body);
    }
    setFiles([]);
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
            To <span className="font-medium text-foreground">{booking.email}</span> · from hello@quintamor.com
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
          <Button onClick={send} disabled={sending || missingInvoice || !subject.trim()}>
            {sending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Mail className="w-4 h-4 mr-1.5" />}
            Send
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
