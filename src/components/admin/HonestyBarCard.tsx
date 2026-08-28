import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Wine } from "lucide-react";

/**
 * Honesty bar (Revolut Merchant) — carte admin de l'onglet Payments.
 * - Sync now : appelle revolut-bar-sync (sinon cron quotidien 04:40 UTC)
 * - File "à classer" : montants ambigus (12 €, 22 €…), un tap sur la bonne
 *   combinaison ; la suggestion (moins d'articles) est proposée en premier.
 * - Ventes sans événement : rattachement manuel à un booking.
 * Prix : vin 22 € (TVA 23 % par prudence), coconut water 4 € (6 %),
 * bière & why not 3 € (23 %).
 */

const PRICE_WINE = 22, PRICE_COCONUT = 4, PRICE_SOFT = 3;

type Sale = {
  id: string; revolut_order_id: string; paid_at: string; amount: number;
  qty_wine: number | null; qty_coconut: number | null; qty_soft: number | null;
  state: string; booking_id: string | null;
};

type BookingOpt = { id: string; retreat_name: string | null; check_in_date: string | null; check_out_date: string | null };

type Qty = { wine: number; coconut: number; soft: number };

function decompositions(amount: number): Qty[] {
  const out: Qty[] = [];
  if (!Number.isInteger(amount) || amount <= 0 || amount > 2000) return out;
  for (let a = 0; a * PRICE_WINE <= amount; a++) {
    for (let b = 0; a * PRICE_WINE + b * PRICE_COCONUT <= amount; b++) {
      const rest = amount - a * PRICE_WINE - b * PRICE_COCONUT;
      if (rest % PRICE_SOFT === 0) out.push({ wine: a, coconut: b, soft: rest / PRICE_SOFT });
    }
  }
  return out.sort((x, y) => (x.wine + x.coconut + x.soft) - (y.wine + y.coconut + y.soft));
}

const qtyLabel = (q: Qty) =>
  [
    q.wine ? `${q.wine} wine` : null,
    q.coconut ? `${q.coconut} coconut` : null,
    q.soft ? `${q.soft} why not / beer` : null,
  ].filter(Boolean).join(" + ") || "nothing";

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Lisbon" });

export function HonestyBarCard() {
  const { toast } = useToast();
  const [sales, setSales] = useState<Sale[]>([]);
  const [bookings, setBookings] = useState<BookingOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    const [sRes, bRes] = await Promise.all([
      supabase.from("bar_sales").select("id,revolut_order_id,paid_at,amount,qty_wine,qty_coconut,qty_soft,state,booking_id")
        .order("paid_at", { ascending: false }).limit(400),
      supabase.from("bookings").select("id,retreat_name,check_in_date,check_out_date")
        .eq("is_test", false).not("check_in_date", "is", null)
        .order("check_in_date", { ascending: false }).limit(100),
    ]);
    setSales((sRes.data as Sale[] | null) ?? []);
    setBookings((bRes.data as BookingOpt[] | null) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const callSync = async (body: Record<string, unknown>, okMsg?: string) => {
    const { data, error } = await supabase.functions.invoke("revolut-bar-sync", { body });
    if (error || data?.error) {
      toast({ title: "Honesty bar", description: String(data?.error || error?.message), variant: "destructive" });
      return null;
    }
    if (okMsg) toast({ title: "Honesty bar", description: okMsg });
    return data;
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const d = await callSync({ action: "sync" });
      if (d) {
        toast({
          title: "Honesty bar synced",
          description: d.configured === false
            ? "Revolut API key not configured yet."
            : `${d.inserted} new sale(s) · ${d.to_classify} to classify · ${d.unassigned} without event.`,
        });
        await load();
      }
    } finally {
      setSyncing(false);
    }
  };

  const classify = async (sale: Sale, q: Qty) => {
    setBusyId(sale.id);
    try {
      const d = await callSync({ action: "classify", sale_id: sale.id, qty_wine: q.wine, qty_coconut: q.coconut, qty_soft: q.soft }, `€${sale.amount} → ${qtyLabel(q)}`);
      if (d) await load();
    } finally {
      setBusyId(null);
    }
  };

  const assign = async (sale: Sale, bookingId: string) => {
    setBusyId(sale.id);
    try {
      const d = await callSync({ action: "assign", sale_id: sale.id, booking_id: bookingId || null }, "Sale linked to the event");
      if (d) await load();
    } finally {
      setBusyId(null);
    }
  };

  const stats = useMemo(() => {
    const classified = sales.filter((s) => s.state === "classified");
    const total = classified.reduce((s, r) => s + Number(r.amount), 0);
    return {
      total,
      count: classified.length,
      ambiguous: sales.filter((s) => s.state !== "classified"),
      unassigned: sales.filter((s) => s.state === "classified" && !s.booking_id),
    };
  }, [sales]);

  const bookingName = (b: BookingOpt) =>
    `${b.retreat_name || "Booking"} (${b.check_in_date.slice(8, 10)}/${b.check_in_date.slice(5, 7)} → ${b.check_out_date.slice(8, 10)}/${b.check_out_date.slice(5, 7)})`;

  return (
    <section className="rounded-2xl bg-card p-4 shadow-sm border border-border/60 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-[#F3EDFF] text-[#8a63d2] flex items-center justify-center">
            <Wine className="w-4 h-4" />
          </span>
          Honesty bar
          <span className="text-xs font-normal text-muted-foreground">
            Revolut · wine €22 (23%) · coconut €4 (6%) · why not / beer €3 (23%) · monthly Consumidor Final fatura auto (1st)
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {stats.count} sale{stats.count === 1 ? "" : "s"} · €{stats.total.toLocaleString("en-GB", { maximumFractionDigits: 2 })}
          </span>
          <Button size="sm" variant="outline" onClick={syncNow} disabled={syncing}>
            {syncing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            Sync now
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground italic">Loading…</div>
      ) : sales.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No sales yet — the daily sync (04:40 UTC) pulls Revolut payments automatically once the API key is configured.
        </p>
      ) : (
        <>
          {stats.ambiguous.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs uppercase text-muted-foreground">To classify ({stats.ambiguous.length})</div>
              {stats.ambiguous.slice(0, 8).map((s) => (
                <div key={s.id} className="rounded-lg border border-[#EFC75B]/60 bg-[#FFF8E4]/50 px-3 py-2 text-sm flex items-center gap-2 flex-wrap">
                  <span className="font-semibold tabular-nums">€{Number(s.amount).toLocaleString("en-GB", { maximumFractionDigits: 2 })}</span>
                  <span className="text-xs text-muted-foreground">{fmtDay(s.paid_at)}</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {decompositions(Number(s.amount)).slice(0, 4).map((q, qi) => (
                      <button
                        key={qi}
                        type="button"
                        disabled={busyId === s.id}
                        onClick={() => classify(s, q)}
                        className="rounded-full border border-border bg-card px-2.5 py-1 text-xs hover:bg-secondary hover:border-[#CAE8BD] transition-colors"
                      >
                        {qtyLabel(q)}{qi === 0 ? " ✓?" : ""}
                      </button>
                    ))}
                    {decompositions(Number(s.amount)).length === 0 && (
                      <span className="text-xs text-muted-foreground italic">No combination of 22/4/3 € matches — refund or custom sale?</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {stats.unassigned.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs uppercase text-muted-foreground">No event linked ({stats.unassigned.length})</div>
              {stats.unassigned.slice(0, 8).map((s) => (
                <div key={s.id} className="rounded-lg border border-border px-3 py-2 text-sm flex items-center gap-2 flex-wrap">
                  <span className="font-semibold tabular-nums">€{Number(s.amount).toLocaleString("en-GB", { maximumFractionDigits: 2 })}</span>
                  <span className="text-xs text-muted-foreground">{fmtDay(s.paid_at)}</span>
                  <select
                    className="h-7 rounded-md border border-input bg-background px-1.5 text-xs max-w-[280px]"
                    defaultValue=""
                    disabled={busyId === s.id}
                    onChange={(e) => e.target.value && assign(s, e.target.value)}
                  >
                    <option value="" disabled>Link to an event…</option>
                    {bookings.map((b) => (
                      <option key={b.id} value={b.id}>{bookingName(b)}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          {stats.ambiguous.length === 0 && stats.unassigned.length === 0 && (
            <p className="text-xs text-muted-foreground">
              All sales are classified and linked. Totals appear per event (booking sheet · Bar group) and on the dashboard.
            </p>
          )}
        </>
      )}
    </section>
  );
}
