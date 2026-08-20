/**
 * Payment UI shared between the Payments page and the Stay summary teaser.
 * Extracted from Dashboard.tsx during the sidebar redesign (août 2026) —
 * logic unchanged: read-only summary + Stripe checkout via stripe-checkout.
 */
import { useState } from 'react';
import { todayLisbon } from '@/lib/dates';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Loader2, Check, CreditCard, Download, Utensils, FileText } from 'lucide-react';
import { usePaymentData, type PaymentInstallment } from '@/hooks/usePaymentData';

export function fmtEur(n: number | null | undefined) {
  const v = Number(n ?? 0);
  return `€${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// Presentation-only status kind: 'pending' is split into "due soon" (within
// 14 days) and "scheduled" for the timeline — same underlying data.
export type InstallmentKind = 'paid' | 'overdue' | 'due_soon' | 'scheduled';

export function installmentKind(s: PaymentInstallment): InstallmentKind {
  const todayIso = todayLisbon();
  if (s.status === 'paid') return 'paid';
  if (s.due_date && s.due_date < todayIso) return 'overdue';
  if (s.due_date) {
    const due = new Date(s.due_date + 'T00:00:00');
    const today = new Date(todayIso + 'T00:00:00');
    const days = Math.round((due.getTime() - today.getTime()) / 86400000);
    if (days <= 14) return 'due_soon';
  }
  return 'scheduled';
}

function installmentBadge(s: PaymentInstallment) {
  const kind = installmentKind(s);
  const map = {
    paid: { label: 'Paid', cls: 'bg-[#EEF1E4] text-[#6D7855]' },
    overdue: { label: 'Overdue', cls: 'bg-destructive/10 text-[#B25C3D]' },
    due_soon: { label: 'Due soon', cls: 'bg-amber-50 text-[#8A6C15]' },
    scheduled: { label: 'Scheduled', cls: 'bg-muted text-muted-foreground' },
  } as const;
  const cfg = map[kind];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${cfg.cls}`}>
      {kind === 'paid' && <Check className="w-3 h-3" />}
      {cfg.label}
    </span>
  );
}

// Timeline dot colour follows the same status kinds.
const TIMELINE_DOT: Record<InstallmentKind, string> = {
  paid: 'bg-[#8CA05F] border-[#8CA05F]',
  overdue: 'bg-[#F36F63] border-[#F36F63]',
  due_soon: 'bg-card border-amber-400',
  scheduled: 'bg-card border-border',
};

export function isPayableOnline(inst: PaymentInstallment) {
  return inst.status !== 'paid' && !inst.is_cash && String(inst.category ?? 'rental') !== 'discount' && Number(inst.amount_due) > 0;
}

export function usePayInstallment() {
  const { toast } = useToast();
  const [payingId, setPayingId] = useState<string | null>(null);

  const payMany = async (insts: PaymentInstallment[], usd = false) => {
    if (insts.length === 0) return;
    setPayingId(insts[0].id);
    try {
      const { data, error } = await supabase.functions.invoke('stripe-checkout', {
        body: { installment_ids: insts.map((i) => i.id), ...(usd ? { usd: true } : {}) },
      });
      if (error || !data?.url) {
        throw new Error(data?.error || error?.message || 'Could not start the payment');
      }
      window.location.href = data.url;
    } catch (e) {
      setPayingId(null);
      toast({
        title: 'Payment unavailable',
        description: e instanceof Error ? e.message : 'Please try again or contact us.',
        variant: 'destructive',
      });
    }
  };

  const pay = (inst: PaymentInstallment) => payMany([inst]);

  return { pay, payMany, payingId };
}

async function downloadInstallmentInvoice(inst: PaymentInstallment) {
  const path = inst.invoice_file_url;
  if (!path) return;
  const { data, error } = await supabase.storage.from('invoices').createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) {
    console.error('[invoice download]', error);
    return;
  }
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
}

// One installment as a timeline entry: status dot on the left, light row content.
function InstallmentRow({ inst, onPay, paying }: { inst: PaymentInstallment; onPay?: (inst: PaymentInstallment) => void; paying?: boolean }) {
  const kind = installmentKind(inst);
  return (
    <div className="relative pl-6 py-2.5">
      <span
        aria-hidden
        className={`absolute left-0 top-[1.05rem] w-2.5 h-2.5 rounded-full border-2 ${TIMELINE_DOT[kind]}`}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{inst.label}</div>
          <div className="text-xs text-muted-foreground">
            Due {fmtDate(inst.due_date) || '—'}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-semibold tabular-nums">{fmtEur(inst.amount_due)}</span>
          {installmentBadge(inst)}
          {onPay && isPayableOnline(inst) && (
            <Button size="sm" onClick={() => onPay(inst)} disabled={paying} className="rounded-full bg-[#6D7855] text-white hover:bg-[#57624A]">
              {paying ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CreditCard className="w-3.5 h-3.5 mr-1" />}
              Pay
            </Button>
          )}
          {inst.invoice_file_url && (
            <Button size="sm" variant="outline" onClick={() => downloadInstallmentInvoice(inst)} className="rounded-full">
              <Download className="w-3.5 h-3.5 mr-1" /> Invoice
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// Vertical guide line behind a list of InstallmentRow timeline entries.
function InstallmentTimeline({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <span aria-hidden className="absolute left-[4px] top-4 bottom-4 w-px bg-border" />
      {children}
    </div>
  );
}

export function NextPaymentCard({ insts, onPay, paying }: { insts: PaymentInstallment[]; onPay: (insts: PaymentInstallment[], usd?: boolean) => void; paying: boolean }) {
  const todayIso = todayLisbon();
  const first = insts[0];
  const overdue = insts.some((i) => !!i.due_date && i.due_date < todayIso);
  const total = insts.reduce((s, i) => s + Number(i.amount_due || 0), 0);
  return (
    <section className="guest-card p-6 sm:p-8">
      <div className={`guest-kicker ${overdue ? 'text-[#B25C3D]' : ''}`}>
        {overdue ? 'Payment due' : insts.length > 1 ? 'Left to pay' : 'Next payment'}
      </div>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-5">
        <div className="min-w-0">
          <div className="text-4xl sm:text-5xl font-semibold tracking-tight tabular-nums text-[#6D7855]">
            {fmtEur(total)}
          </div>
          {insts.length === 1 ? (
            <div className="mt-2 text-sm text-muted-foreground">
              {first.label}
              {first.due_date ? <> · due <span className="font-medium text-foreground">{fmtDate(first.due_date)}</span></> : ''}
            </div>
          ) : (
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              {insts.map((i) => (
                <li key={i.id} className="flex items-baseline gap-2">
                  <span className="font-medium text-foreground tabular-nums">{fmtEur(i.amount_due)}</span>
                  <span className="truncate">{i.label}</span>
                  {i.due_date && <span className="whitespace-nowrap">· due {fmtDate(i.due_date)}</span>}
                </li>
              ))}
              <li className="text-xs pt-0.5">{insts.length} payments — settled together in one go.</li>
            </ul>
          )}
        </div>
        <Button
          size="lg"
          onClick={() => onPay(insts)}
          disabled={paying}
          className="shrink-0 w-full sm:w-auto rounded-full px-7 bg-[#6D7855] text-white hover:bg-[#57624A]"
        >
          {paying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CreditCard className="w-4 h-4 mr-2" />}
          Pay {fmtEur(total)}
        </Button>
      </div>
      <div className="mt-4 pt-4 border-t border-border/70 text-xs text-muted-foreground">
        Secure payment — you'll be redirected to our payment partner Stripe.
        {' '}
        <button
          type="button"
          onClick={() => onPay(insts, true)}
          disabled={paying}
          className="underline underline-offset-2 hover:text-foreground"
        >
          Paying from outside Europe? Pay in USD instead (US bank debit or card)
        </button>
      </div>
    </section>
  );
}

/** TOUS les installments payables en ligne (accommodation, catering, extras),
 *  triés par due date — un seul checkout Stripe pour tout régler d'un coup
 *  (même logique que les grouped payments côté admin). */
export function nextPayableGroup(payments: PaymentInstallment[]): PaymentInstallment[] {
  return payments
    .filter(isPayableOnline)
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
}

export function PaymentOverview({ bookingId }: { bookingId: string | null | undefined }) {
  const { booking, payments, isLoading } = usePaymentData(bookingId);
  const { pay, payMany, payingId } = usePayInstallment();

  if (isLoading) return null;

  const rental = payments.filter((i) => (i.category ?? 'rental') === 'rental');
  const catering = payments.filter((i) => i.category === 'catering');
  const extras = payments.filter((i) => i.category === 'extra');

  const nextGroup = nextPayableGroup(payments);

  const hasAccommodation = rental.length > 0 || (booking?.total_rental_price ?? 0) > 0;
  const hasExtras = extras.length > 0;

  // catering.length : un booking 100 % catering doit voir sa carte de paiement
  if (!hasAccommodation && !hasExtras && catering.length === 0) {
    return (
      <div className="guest-card p-6 flex items-start gap-3">
        <CreditCard className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
        <div>
          <div className="text-sm font-semibold">Payment</div>
          <div className="text-sm text-muted-foreground">Payment details will appear here once confirmed.</div>
        </div>
      </div>
    );
  }

  // Ce que la cliente paie : prix de base − remise.
  const totalDue = Math.max(0, Number(booking?.total_rental_price ?? 0) - Number(booking?.rental_discount ?? 0));
  const totalPaid = rental.filter((i) => i.status === 'paid').reduce((s, i) => s + Number(i.amount_due || 0), 0);
  const remaining = Math.max(totalDue - totalPaid, 0);
  const pct = totalDue > 0 ? Math.min(100, Math.round((totalPaid / totalDue) * 100)) : 0;

  const extrasTotal = extras.reduce((s, i) => s + Number(i.amount_due || 0), 0);
  const extrasPaid = extras.filter((i) => i.status === 'paid').reduce((s, i) => s + Number(i.amount_due || 0), 0);
  const extrasOutstanding = Math.max(extrasTotal - extrasPaid, 0);

  return (
    <div className="space-y-4">
      {nextGroup.length > 0 && (
        <NextPaymentCard insts={nextGroup} onPay={payMany} paying={payingId === nextGroup[0].id} />
      )}
      {hasAccommodation && (
        <section className="guest-card p-6">
          <div className="flex items-center gap-2.5 mb-5">
            <span className="text-[#6D7855] flex items-center justify-center">
              <CreditCard className="w-4 h-4" />
            </span>
            <h2 className="text-base font-semibold tracking-tight">Accommodation</h2>
          </div>

          {totalDue > 0 && (
            <div className="mb-5">
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-[#8CA05F] transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-xs">
                <span className="font-medium text-foreground tabular-nums">{fmtEur(totalPaid)} paid</span>
                <span className="text-muted-foreground tabular-nums">{fmtEur(remaining)} remaining</span>
              </div>
            </div>
          )}

          {rental.length > 0 && (
            <InstallmentTimeline>{rental.map((i) => <InstallmentRow key={i.id} inst={i} onPay={pay} paying={payingId === i.id} />)}</InstallmentTimeline>
          )}

          {totalDue > 0 && (
            <div className="mt-3 pt-3 border-t border-border/70 text-xs text-muted-foreground tabular-nums">
              {fmtEur(totalPaid)} paid of {fmtEur(totalDue)} · {fmtEur(remaining)} remaining
            </div>
          )}
        </section>
      )}

      {catering.length > 0 && (
        <section className="guest-card p-6">
          <div className="flex items-center gap-2.5 mb-5">
            <span className="text-[#6D7855] flex items-center justify-center">
              <Utensils className="w-4 h-4" />
            </span>
            <h2 className="text-base font-semibold tracking-tight">Catering</h2>
          </div>
          <InstallmentTimeline>{catering.map((i) => <InstallmentRow key={i.id} inst={i} onPay={pay} paying={payingId === i.id} />)}</InstallmentTimeline>
        </section>
      )}

      {hasExtras && (
        <section className="guest-card p-6">
          <div className="flex items-center gap-2.5 mb-5">
            <span className="text-[#6D7855] flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </span>
            <h2 className="text-base font-semibold tracking-tight">Extras</h2>
          </div>

          <InstallmentTimeline>{extras.map((i) => <InstallmentRow key={i.id} inst={i} onPay={pay} paying={payingId === i.id} />)}</InstallmentTimeline>

          <div className="mt-3 pt-3 border-t border-border/70 text-xs text-muted-foreground tabular-nums">
            Extras total: {fmtEur(extrasTotal)} · {fmtEur(extrasPaid)} paid · {fmtEur(extrasOutstanding)} outstanding
          </div>
        </section>
      )}
    </div>
  );
}
