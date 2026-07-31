import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Mail, Paperclip } from "lucide-react";

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

export function buildRequestTemplate(booking: EmailBooking, inst: EmailInstallment, ordinal: number, isLast: boolean) {
  const first = (booking.first_name ?? "").trim() || "there";
  const stay = stayRange(booking.check_in_date, booking.check_out_date);
  const stayLine = stay
    ? `Your stay at Quinta do Amor from ${stay} is getting close`
    : `Your stay at Quinta do Amor is getting close`;
  return {
    subject: `Your stay at Quinta do Amor — ${isLast ? "final payment" : "payment"}`,
    bodyTop:
`Hi ${first},

I hope you're doing well!

${stayLine}

Here's the link for the ${ordinalWord(ordinal)}${isLast ? " and final" : ""} payment for your stay:`,
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
  onSent?: () => void;
}) {
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [bodyTop, setBodyTop] = useState("");
  const [bodyBottom, setBodyBottom] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  // (Re)charge le template à chaque ouverture
  useEffect(() => {
    if (!open) return;
    if (kind === "request") {
      const t = buildRequestTemplate(booking, inst, ordinal, isLast);
      setSubject(t.subject); setBodyTop(t.bodyTop); setBodyBottom(t.bodyBottom);
    } else {
      const t = buildConfirmationTemplate(booking, inst, allSettled);
      setSubject(t.subject); setBody(t.body);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, inst.id]);

  const missingInvoice = kind === "confirmation" && !inst.invoice_file_url;

  const send = async () => {
    setSending(true);
    try {
      const payload = kind === "request"
        ? { kind, installment_id: inst.id, subject, body_top: bodyTop, body_bottom: bodyBottom }
        : { kind, installment_id: inst.id, subject, body };
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
      <DialogContent className="sm:max-w-[560px]">
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
                  Pay {fmtEur(Number(inst.amount_due))}
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
