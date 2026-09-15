import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, Loader2, Percent } from "lucide-react";

/**
 * Marges par événement (18 août 2026) — méthode validée avec Geoffroy :
 * 3 étages de marge, jamais mélangés, et chaque formule AFFICHÉE en clair
 * pour qu'un lecteur extérieur comprenne d'où vient chaque chiffre.
 *
 * M1 — marge directe : revenus HT − coûts directement rattachés au booking.
 * M2 — après allocation des coûts de saison (clés simples, éditables ici,
 *      stockées dans app_settings.margin_keys) :
 *      · cleaning : le RÉEL "Cleaning (in season)" non rattaché est réparti
 *        au prorata des heures théoriques (turnover + midweek si ≥ 4 nuits)
 *      · électricité : standard €/nuit (calibré sur l'excédent saison)
 *      · gardening saisonnier + pool + supplies : au prorata des jours
 *      · assurance events : divisée par le nombre d'événements
 *      · maintenance récurrente (lignes ≤ seuil) : au prorata des jours
 * M3 — indicatif : coûts de structure / jour d'événement (plancher pricing).
 */

type MarginKeys = {
  cleaning_turnover_hours: number;
  cleaning_midweek_hours: number;
  cleaning_rate: number;
  elec_per_night: number;
  elec_catering_share: number; // %
  maint_oneoff_threshold: number;
};

const DEFAULT_KEYS: MarginKeys = {
  cleaning_turnover_hours: 30,
  cleaning_midweek_hours: 4,
  cleaning_rate: 20,
  elec_per_night: 50,
  elec_catering_share: 33,
  maint_oneoff_threshold: 500,
};

const CATERING_COST_CATS = [
  "Retreat — catering / food", "Retreat — catering / staff",
  "Wedding — catering / food", "Wedding — catering / staff", "Bar — stock",
];
const SEASON_OPS_CATS = ["Gardening (seasonal)", "Pool maintenance", "Property operations & supplies"];
// Le cleaning des événements vit dans ces catégories (demande Geoffroy,
// 18 août 2026) — en plus de "Cleaning (in season)". Les lignes RATTACHÉES à
// un booking comptent en M1 (coût direct réel) ; seules les lignes non
// rattachées forment le pool réparti aux heures théoriques.
const CLEANING_CATS = ["Cleaning (in season)", "Retreat — venue / cleaning & fixed", "Wedding — venue / cleaning & fixed"];

const fmt = (n: number) => `€${Math.round(n).toLocaleString("en-GB")}`;
const pct = (n: number, base: number) => (base > 0 ? `${Math.round((n / base) * 100)}%` : "—");
const inSeason = (d: string) => { const m = Number(d.slice(5, 7)); return m >= 5 && m <= 10; };

type BookingRow = {
  id: string; retreat_name: string | null; first_name: string | null; last_name: string | null;
  event_type: string | null; check_in_date: string | null; check_out_date: string | null;
};
type InstRow = { booking_id: string; category: string | null; amount_due: number; amount_excl_vat: number | null };
type TxRow = { booking_id: string | null; category: string | null; amount: number; amount_net: number | null; date: string; kind: string };

export function EventMarginsTab({ year }: { year: string }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [insts, setInsts] = useState<InstRow[]>([]);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [keys, setKeys] = useState<MarginKeys>(DEFAULT_KEYS);
  const [keysDraft, setKeysDraft] = useState<MarginKeys>(DEFAULT_KEYS);
  const [savingKeys, setSavingKeys] = useState(false);
  const [showMethod, setShowMethod] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Deux vues (15 sept 2026, demande Geoffroy) : "By product" = ses formules
  // simples par produit (rental / catering / extras), "Detailed" = M1/M2/M3.
  const [view, setView] = useState<"products" | "detail">("products");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [b, s] = await Promise.all([
        supabase.from("bookings")
          .select("id,retreat_name,first_name,last_name,event_type,check_in_date,check_out_date")
          .gte("check_in_date", `${year}-01-01`).lt("check_in_date", `${Number(year) + 1}-01-01`)
          .order("check_in_date"),
        supabase.from("app_settings").select("value").eq("key", "margin_keys").maybeSingle(),
      ]);
      const rows = (b.data ?? []) as BookingRow[];
      setBookings(rows);
      const loaded = { ...DEFAULT_KEYS, ...((s.data?.value as Partial<MarginKeys> | null) ?? {}) };
      setKeys(loaded); setKeysDraft(loaded);
      const ids = rows.map((r) => r.id);
      const [i, t] = await Promise.all([
        ids.length
          ? supabase.from("payment_installments").select("booking_id,category,amount_due,amount_excl_vat").in("booking_id", ids)
          : Promise.resolve({ data: [] }),
        supabase.from("fin_transactions").select("booking_id,category,amount,amount_net,date,kind")
          .eq("kind", "expense").gte("date", `${year}-01-01`).lt("date", `${Number(year) + 1}-01-01`),
      ]);
      setInsts((i.data ?? []) as InstRow[]);
      setTxs((t.data ?? []) as TxRow[]);
      setLoading(false);
    })();
  }, [year]);

  const saveKeys = async () => {
    setSavingKeys(true);
    const { error } = await supabase.from("app_settings").upsert({ key: "margin_keys", value: keysDraft });
    setSavingKeys(false);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    setKeys(keysDraft);
    toast({ title: "Allocation keys saved" });
  };

  const model = useMemo(() => {
    const ht = (t: TxRow) => Math.abs(t.amount_net ?? t.amount);
    const events = bookings.map((b) => {
      const nights = b.check_in_date && b.check_out_date
        ? Math.max(0, Math.round((new Date(b.check_out_date).getTime() - new Date(b.check_in_date).getTime()) / 86400000))
        : 0;
      return {
        b,
        name: b.retreat_name || `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim() || "—",
        nights,
        days: Math.max(nights, 1), // day retreat (0 nuit) = 1 jour d'occupation
      };
    });
    const totalDays = events.reduce((s, e) => s + e.days, 0);
    const nEvents = events.length;

    // ---- Pools (dépenses NON rattachées à un booking — le rattaché est en M1)
    const unlinked = txs.filter((t) => !t.booking_id);
    const cleaningPool = unlinked.filter((t) => CLEANING_CATS.includes(t.category ?? "")).reduce((s, t) => s + ht(t), 0);
    // Dépense cleaning TOTALE (rattachée + non rattachée) — sert au garde-fou
    // "heures impliquées par le réel" : total / taux horaire / nb d'événements.
    const cleaningTotal = txs.filter((t) => CLEANING_CATS.includes(t.category ?? "")).reduce((s, t) => s + ht(t), 0);
    const seasonOpsPool = unlinked.filter((t) => SEASON_OPS_CATS.includes(t.category ?? "") && inSeason(t.date)).reduce((s, t) => s + ht(t), 0);
    const insurancePool = unlinked.filter((t) => t.category === "Insurance — events").reduce((s, t) => s + ht(t), 0);
    const maintPool = unlinked.filter((t) => t.category === "General maintenance" && inSeason(t.date) && ht(t) <= keys.maint_oneoff_threshold).reduce((s, t) => s + ht(t), 0);
    const elecActualSeason = unlinked.filter((t) => t.category === "Electricity" && inSeason(t.date)).reduce((s, t) => s + ht(t), 0);

    // Heures de cleaning théoriques par événement — clé de répartition du pool
    const theoHours = (e: { nights: number }) =>
      keys.cleaning_turnover_hours + (e.nights >= 4 ? keys.cleaning_midweek_hours : 0);
    const totalTheoHours = events.reduce((s, e) => s + theoHours(e), 0);
    const impliedRate = totalTheoHours > 0 ? cleaningTotal / totalTheoHours : 0;
    const impliedTurnoverHours = nEvents > 0 && keys.cleaning_rate > 0
      ? cleaningTotal / keys.cleaning_rate / nEvents
      : 0;

    // ---- Structure (M3, indicatif) : tout le reste des dépenses de l'année,
    // hors coûts rattachés et hors pools déjà alloués en M2.
    const pooledCats = new Set([...CLEANING_CATS, "Insurance — events", ...SEASON_OPS_CATS]);
    const structurePool = unlinked.reduce((s, t) => {
      const c = t.category ?? "";
      if (pooledCats.has(c)) return s;
      if (c === "General maintenance" && inSeason(t.date) && ht(t) <= keys.maint_oneoff_threshold) return s;
      return s + ht(t);
    }, 0);
    const structurePerDay = totalDays > 0 ? structurePool / totalDays : 0;

    // ---- Par événement
    const rows = events.map((e) => {
      const bInsts = insts.filter((i) => i.booking_id === e.b.id);
      const instHt = (i: InstRow) => Number(i.amount_excl_vat ?? i.amount_due);
      const revVenue = bInsts.filter((i) => ["rental", "extra", "discount"].includes(i.category ?? "")).reduce((s, i) => s + instHt(i), 0);
      const revCat = bInsts.filter((i) => ["catering", "bar"].includes(i.category ?? "")).reduce((s, i) => s + instHt(i), 0);

      const linked = txs.filter((t) => t.booking_id === e.b.id);
      const directCat = linked.filter((t) => CATERING_COST_CATS.includes(t.category ?? "")).reduce((s, t) => s + ht(t), 0);
      const directVenue = linked.filter((t) => !CATERING_COST_CATS.includes(t.category ?? "")).reduce((s, t) => s + ht(t), 0);

      const m1Venue = revVenue - directVenue;
      const m1Cat = revCat - directCat;

      const hours = theoHours(e);
      const cleaningAlloc = totalTheoHours > 0 ? cleaningPool * (hours / totalTheoHours) : 0;
      const elec = keys.elec_per_night * e.days;
      const elecCat = revCat > 0 ? elec * (keys.elec_catering_share / 100) : 0;
      const elecVenue = elec - elecCat;
      const seasonAlloc = totalDays > 0 ? seasonOpsPool * (e.days / totalDays) : 0;
      const insAlloc = nEvents > 0 ? insurancePool / nEvents : 0;
      const maintAlloc = totalDays > 0 ? maintPool * (e.days / totalDays) : 0;

      const m2Venue = m1Venue - cleaningAlloc - elecVenue - seasonAlloc - insAlloc - maintAlloc;
      const m2Cat = m1Cat - elecCat;
      const m2 = m2Venue + m2Cat;
      const m3 = m2 - structurePerDay * e.days;

      return {
        ...e, revVenue, revCat, directVenue, directCat, m1Venue, m1Cat,
        hours, cleaningAlloc, elec, elecCat, elecVenue, seasonAlloc, insAlloc, maintAlloc,
        m2Venue, m2Cat, m2, m3,
      };
    });

    const elecAllocTotal = rows.reduce((s, r) => s + r.elec, 0);
    return {
      rows, totalDays, nEvents, cleaningPool, cleaningTotal, seasonOpsPool, insurancePool, maintPool,
      structurePool, structurePerDay, impliedRate, impliedTurnoverHours, elecActualSeason, elecAllocTotal,
      totalTheoHours,
    };
  }, [bookings, insts, txs, keys]);

  // ---- Vue "par produit" (15 sept 2026) — formules validées avec Geoffroy :
  // Rental  = prix rental HT (remises déduites) − coûts liés à l'event (hors
  //           catering/transport) − coûts fixes de l'année au prorata des
  //           JOURS − cleaning saison ÷ nb d'events − gardening saison ÷ nb
  //           d'events (cleaning coûte pareil pour 4 ou 8 jours ; le gardening
  //           doit être fait quoi qu'il arrive → répartition PAR ÉVÉNEMENT).
  // Catering = revenu catering + bar HT − food & staff liés à l'event − part
  //           du pool food/staff non rattaché (au prorata du revenu catering).
  // Extras  = revenu extras/transport HT − Guest transport lié à l'event.
  const productModel = useMemo(() => {
    const ht = (t: TxRow) => Math.abs(t.amount_net ?? t.amount);
    const events = bookings.map((b) => {
      const nights = b.check_in_date && b.check_out_date
        ? Math.max(0, Math.round((new Date(b.check_out_date).getTime() - new Date(b.check_in_date).getTime()) / 86400000))
        : 0;
      return {
        b,
        name: b.retreat_name || `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim() || "—",
        nights,
        days: Math.max(nights, 1),
      };
    });
    const totalDays = events.reduce((s, e) => s + e.days, 0);
    const nEvents = events.length;
    const unlinked = txs.filter((t) => !t.booking_id);
    const cleaningPool = unlinked.filter((t) => CLEANING_CATS.includes(t.category ?? "")).reduce((s, t) => s + ht(t), 0);
    const gardeningPool = unlinked.filter((t) => t.category === "Gardening (seasonal)").reduce((s, t) => s + ht(t), 0);
    const cateringPool = unlinked.filter((t) => CATERING_COST_CATS.includes(t.category ?? "")).reduce((s, t) => s + ht(t), 0);
    // Hors coûts fixes : capex amortissable (Improvement works) et dépenses
    // payées pour le compte de Surreal (refacturées — pas un coût d'OHM).
    const FIXED_EXCLUDED = new Set(["Paid on behalf of Surreal (property)", "Improvement works (leasehold)"]);
    const fixedPool = unlinked.reduce((s, t) => {
      const c = t.category ?? "";
      if (CLEANING_CATS.includes(c) || c === "Gardening (seasonal)" || CATERING_COST_CATS.includes(c) || FIXED_EXCLUDED.has(c)) return s;
      return s + ht(t);
    }, 0);

    const instHt = (i: InstRow) => Number(i.amount_excl_vat ?? i.amount_due);
    const revCatOf = (id: string) =>
      insts.filter((i) => i.booking_id === id && ["catering", "bar"].includes(i.category ?? "")).reduce((s, i) => s + instHt(i), 0);
    const totalRevCat = events.reduce((s, e) => s + revCatOf(e.b.id), 0);

    const rows = events.map((e) => {
      const bInsts = insts.filter((i) => i.booking_id === e.b.id);
      const revRental = bInsts.filter((i) => ["rental", "discount"].includes(i.category ?? "")).reduce((s, i) => s + instHt(i), 0);
      const revCat = revCatOf(e.b.id);
      const revExtra = bInsts.filter((i) => !["rental", "discount", "catering", "bar"].includes(i.category ?? "")).reduce((s, i) => s + instHt(i), 0);

      const linked = txs.filter((t) => t.booking_id === e.b.id);
      const linkedCatering = linked.filter((t) => CATERING_COST_CATS.includes(t.category ?? "")).reduce((s, t) => s + ht(t), 0);
      const linkedTransport = linked.filter((t) => t.category === "Guest transport").reduce((s, t) => s + ht(t), 0);
      const linkedVenue = linked.filter((t) => !CATERING_COST_CATS.includes(t.category ?? "") && t.category !== "Guest transport").reduce((s, t) => s + ht(t), 0);

      const fixedAlloc = totalDays > 0 ? fixedPool * (e.days / totalDays) : 0;
      const cleaningAlloc = nEvents > 0 ? cleaningPool / nEvents : 0;
      const gardeningAlloc = nEvents > 0 ? gardeningPool / nEvents : 0;
      const cateringPoolAlloc = totalRevCat > 0 ? cateringPool * (revCat / totalRevCat) : 0;

      const rentalMargin = revRental - linkedVenue - fixedAlloc - cleaningAlloc - gardeningAlloc;
      const cateringMargin = revCat - linkedCatering - cateringPoolAlloc;
      const extrasMargin = revExtra - linkedTransport;
      return {
        ...e, revRental, revCat, revExtra, linkedCatering, linkedTransport, linkedVenue,
        fixedAlloc, cleaningAlloc, gardeningAlloc, cateringPoolAlloc,
        rentalMargin, cateringMargin, extrasMargin,
        total: rentalMargin + cateringMargin + extrasMargin,
      };
    });
    return { rows, totalDays, nEvents, cleaningPool, gardeningPool, cateringPool, fixedPool, totalRevCat };
  }, [bookings, insts, txs]);

  if (loading) return <div className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-muted-foreground" /></div>;

  const K = ({ field, step = 1, w = "w-16" }: { field: keyof MarginKeys; step?: number; w?: string }) => (
    <Input type="number" min="0" step={step} value={String(keysDraft[field])}
      onChange={(e) => setKeysDraft((k) => ({ ...k, [field]: Number(e.target.value) || 0 }))}
      className={`h-6 ${w} inline-block px-1.5 text-xs text-right align-baseline mx-0.5`} />
  );
  const keysDirty = JSON.stringify(keys) !== JSON.stringify(keysDraft);

  const pm = productModel;

  return (
    <div className="space-y-4">
      {/* Deux vues : par produit (formules simples) / détaillée M1-M2-M3 */}
      <div className="flex gap-1.5">
        {([["products", "By product"], ["detail", "Detailed (M1 / M2 / M3)"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setView(k)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold border ${view === k ? "bg-foreground text-background border-foreground" : "bg-card text-muted-foreground border-border hover:text-foreground"}`}>
            {label}
          </button>
        ))}
      </div>

      {view === "products" && (
        <>
          {/* Méthode — les règles de Geoffroy, affichées en clair */}
          <div className="rounded-2xl border border-border bg-card shadow-sm px-4 py-3.5 text-xs text-muted-foreground space-y-2 leading-relaxed">
            <p>
              <span className="font-semibold text-foreground">Rental</span> — rental revenue excl. VAT (discounts deducted)
              − costs linked to this event (cleaning, supplies, maintenance…)
              − fixed costs of {year} ({fmt(pm.fixedPool)}) shared <span className="text-foreground">pro-rata event days</span> ({pm.totalDays} days total)
              − season cleaning pool ({fmt(pm.cleaningPool)}) split <span className="text-foreground">equally per event</span> (cleaning costs the same for a 4-day or 8-day event)
              − seasonal gardening ({fmt(pm.gardeningPool)}) split <span className="text-foreground">equally per event</span> (it has to happen regardless).
            </p>
            <p>
              <span className="font-semibold text-foreground">Catering</span> — catering + bar revenue excl. VAT
              − food &amp; staff costs linked to this event
              {pm.cateringPool > 0.005 && <> − a share of the unassigned food/staff pool ({fmt(pm.cateringPool)}, split by catering revenue — link those lines to their event to sharpen this)</>}.
            </p>
            <p>
              <span className="font-semibold text-foreground">Extras</span> — transport &amp; extras revenue − Guest transport costs linked to the event.
            </p>
            <p className="text-[11px]">
              Fixed costs exclude "Paid on behalf of Surreal" (re-invoiced) and "Improvement works" (capex).
              Everything is net of VAT. The more transactions you link to events, the sharper these margins get.
            </p>
          </div>

          <div className="overflow-auto rounded-2xl bg-card shadow-sm border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/80">
                <tr className="text-left">
                  {["Event", "Days", "Rental margin", "Catering margin", "Extras", "Total", ""].map((h, i) => (
                    <th key={i} className={`px-3 py-2.5 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground whitespace-nowrap ${i >= 2 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pm.rows.map((r) => {
                  const open = expanded.has(r.b.id);
                  return (
                    <Fragment key={r.b.id}>
                      <tr className="border-t border-border/60 cursor-pointer hover:bg-muted/30"
                        onClick={() => setExpanded((s) => { const n = new Set(s); if (open) { n.delete(r.b.id); } else { n.add(r.b.id); } return n; })}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{r.name}</div>
                          <div className="text-[10px] text-muted-foreground capitalize">{(r.b.event_type ?? "").replace("_", " ")}</div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.nights > 0 ? `${r.nights} n` : "day"}</td>
                        <td className={`px-3 py-2 text-right whitespace-nowrap font-medium ${r.rentalMargin < 0 ? "text-[#B3261E]" : ""}`}>
                          {fmt(r.rentalMargin)} <span className="text-[10px] font-normal text-muted-foreground">{pct(r.rentalMargin, r.revRental)}</span>
                        </td>
                        <td className={`px-3 py-2 text-right whitespace-nowrap font-medium ${r.cateringMargin < 0 ? "text-[#B3261E]" : ""}`}>
                          {r.revCat > 0.005 ? <>{fmt(r.cateringMargin)} <span className="text-[10px] font-normal text-muted-foreground">{pct(r.cateringMargin, r.revCat)}</span></> : "—"}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {r.revExtra > 0.005 || r.linkedTransport > 0.005 ? fmt(r.extrasMargin) : "—"}
                        </td>
                        <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${r.total < 0 ? "text-[#B3261E]" : "text-[#35532A]"}`}>
                          {fmt(r.total)}
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                      </tr>
                      {open && (
                        <tr className="border-t border-border/40 bg-muted/20">
                          <td colSpan={7} className="px-4 py-3">
                            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1 text-xs max-w-3xl">
                              <div className="font-semibold text-[11px] uppercase tracking-wide text-muted-foreground pt-1">Rental</div>
                              <div className="font-semibold text-[11px] uppercase tracking-wide text-muted-foreground pt-1">Catering</div>
                              <Detail label="Rental revenue (discounts deducted)" v={r.revRental} />
                              <Detail label="Catering + bar revenue" v={r.revCat} />
                              <Detail label="− Costs linked to this event (venue)" v={-r.linkedVenue} />
                              <Detail label="− Food & staff linked to this event" v={-r.linkedCatering} />
                              <Detail label={`− Fixed costs: ${r.days}/${pm.totalDays} days of ${fmt(pm.fixedPool)}`} v={-r.fixedAlloc} />
                              <Detail label={pm.cateringPool > 0.005 ? `− Share of unassigned food/staff pool` : "(all catering costs are linked)"} v={-r.cateringPoolAlloc} />
                              <Detail label={`− Cleaning: 1/${pm.nEvents} of ${fmt(pm.cleaningPool)}`} v={-r.cleaningAlloc} />
                              <Detail label="= Catering margin" v={r.cateringMargin} strong />
                              <Detail label={`− Gardening (seasonal): 1/${pm.nEvents} of ${fmt(pm.gardeningPool)}`} v={-r.gardeningAlloc} />
                              <div />
                              <Detail label="= Rental margin" v={r.rentalMargin} strong />
                              <div />
                            </div>
                            {(r.revExtra > 0.005 || r.linkedTransport > 0.005) && (
                              <div className="mt-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
                                Extras: revenue {fmt(r.revExtra)} − Guest transport linked {fmt(r.linkedTransport)} =
                                <span className="font-semibold text-foreground ml-1">{fmt(r.extrasMargin)}</span>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {pm.rows.length > 0 && (
                  <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                    <td className="px-3 py-2">Total {year}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{pm.totalDays} d</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{fmt(pm.rows.reduce((s, r) => s + r.rentalMargin, 0))}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{fmt(pm.rows.reduce((s, r) => s + r.cateringMargin, 0))}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{fmt(pm.rows.reduce((s, r) => s + r.extrasMargin, 0))}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap text-[#35532A]">{fmt(pm.rows.reduce((s, r) => s + r.total, 0))}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === "detail" && (
      <>
      {/* Méthodologie — toujours visible pour qu'un lecteur comprenne le calcul */}
      <div className="rounded-2xl border border-border bg-card shadow-sm">
        <button type="button" className="w-full flex items-center justify-between px-4 py-3 text-left"
          onClick={() => setShowMethod((v) => !v)}>
          <span className="font-semibold text-sm flex items-center gap-2">
            <Percent className="w-4 h-4 text-[#35532A]" /> How these margins are computed
          </span>
          {showMethod ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </button>
        {showMethod && (
          <div className="px-4 pb-4 text-xs text-muted-foreground space-y-2.5 leading-relaxed">
            <p>
              <span className="font-semibold text-foreground">M1 — Direct margin.</span>{" "}
              Revenue excl. VAT (venue = rental + extras − discounts · catering = catering + bar) minus the costs
              directly linked to this event in Accounting (food, catering staff, cleaning supplies, extras…).
              No allocation, no estimate — only what was actually spent for this event.
            </p>
            <p>
              <span className="font-semibold text-foreground">M2 — After allocated season costs.</span>{" "}
              Shared season costs are spread across the {model.nEvents} events ({model.totalDays} event-days) of {year}:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <span className="text-foreground">Cleaning</span> — cleaning spend lives in
                "Retreat/Wedding — venue / cleaning &amp; fixed" and "Cleaning (in season)".
                Lines linked to an event count directly in its M1; the unassigned rest ({fmt(model.cleaningPool)})
                is split by theoretical hours: <K field="cleaning_turnover_hours" /> h per turnover
                + <K field="cleaning_midweek_hours" /> h midweek for events of 4+ nights.
                Reality check: total cleaning spend {fmt(model.cleaningTotal)} at <K field="cleaning_rate" /> €/h
                implies ≈ {model.impliedTurnoverHours.toFixed(1)} h per event
                (implied rate on your theoretical hours: €{model.impliedRate.toFixed(1)}/h).
              </li>
              <li>
                <span className="text-foreground">Electricity</span> — standard of <K field="elec_per_night" /> €/event-day
                (calibrated on the in-season excess over the off-season baseline).
                Events with catering carry <K field="elec_catering_share" /> % of it on the catering margin.
                Check: allocated {fmt(model.elecAllocTotal)} vs actual in-season bills {fmt(model.elecActualSeason)}.
              </li>
              <li>
                <span className="text-foreground">Seasonal gardening, pool & supplies</span> ({fmt(model.seasonOpsPool)}) — per event-day.
              </li>
              <li>
                <span className="text-foreground">Events insurance</span> ({fmt(model.insurancePool)}) — split equally per event
                (≈ {fmt(model.nEvents ? model.insurancePool / model.nEvents : 0)}).
              </li>
              <li>
                <span className="text-foreground">Recurring maintenance</span> — in-season General maintenance lines
                of <K field="maint_oneoff_threshold" w="w-20" /> € or less ({fmt(model.maintPool)}) per event-day;
                bigger lines are one-off works and stay out of event margins.
              </li>
            </ul>
            <p>
              <span className="font-semibold text-foreground">M3 — Fully loaded (indicative only).</span>{" "}
              All remaining {year} costs — payroll, contracts, admin, equipment… ({fmt(model.structurePool)}) —
              spread that's {fmt(model.structurePerDay)}/event-day. Never judge one event on M3;
              it is the pricing floor: an event whose M2 per day is below {fmt(model.structurePerDay)} destroys value on a full-year view.
            </p>
            {keysDirty && (
              <div className="pt-1">
                <Button size="sm" className="h-7 text-xs" onClick={saveKeys} disabled={savingKeys}>
                  {savingKeys ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save allocation keys"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tableau par événement */}
      <div className="overflow-auto rounded-2xl bg-card shadow-sm border border-border/60">
        <table className="w-full text-sm">
          <thead className="bg-muted/80">
            <tr className="text-left">
              {["Event", "Days", "Venue rev.", "Catering rev.", "M1 venue", "M1 catering", "M2 (allocated)", ""].map((h, i) => (
                <th key={i} className={`px-3 py-2.5 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground whitespace-nowrap ${i >= 2 ? "text-right" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.rows.map((r) => {
              const open = expanded.has(r.b.id);
              return (
                <Fragment key={r.b.id}>
                  <tr className="border-t border-border/60 cursor-pointer hover:bg-muted/30"
                    onClick={() => setExpanded((s) => { const n = new Set(s); if (open) { n.delete(r.b.id); } else { n.add(r.b.id); } return n; })}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-[10px] text-muted-foreground capitalize">{(r.b.event_type ?? "").replace("_", " ")}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.nights > 0 ? `${r.nights} n` : "day"}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{fmt(r.revVenue)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{r.revCat > 0 ? fmt(r.revCat) : "—"}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {fmt(r.m1Venue)} <span className="text-[10px] text-muted-foreground">{pct(r.m1Venue, r.revVenue)}</span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {r.revCat > 0 ? <>{fmt(r.m1Cat)} <span className="text-[10px] text-muted-foreground">{pct(r.m1Cat, r.revCat)}</span></> : "—"}
                    </td>
                    <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${r.m2 < 0 ? "text-[#B3261E]" : "text-[#35532A]"}`}>
                      {fmt(r.m2)} <span className="text-[10px] font-normal text-muted-foreground">{pct(r.m2, r.revVenue + r.revCat)}</span>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                  </tr>
                  {open && (
                    <tr className="border-t border-border/40 bg-muted/20">
                      <td colSpan={8} className="px-4 py-3">
                        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1 text-xs max-w-3xl">
                          <div className="font-semibold text-[11px] uppercase tracking-wide text-muted-foreground pt-1">Venue</div>
                          <div className="font-semibold text-[11px] uppercase tracking-wide text-muted-foreground pt-1">Catering</div>
                          <Detail label="Revenue (rental + extras − discounts)" v={r.revVenue} />
                          <Detail label="Revenue (catering + bar)" v={r.revCat} />
                          <Detail label="− Direct costs linked to this event" v={-r.directVenue} />
                          <Detail label="− Food & catering staff (linked)" v={-r.directCat} />
                          <Detail label="= M1 venue" v={r.m1Venue} strong />
                          <Detail label="= M1 catering" v={r.m1Cat} strong />
                          <Detail label={`− Cleaning: ${r.hours} h theoretical (${keys.cleaning_turnover_hours} h turnover${r.nights >= 4 ? ` + ${keys.cleaning_midweek_hours} h midweek` : ""}) × share of season spend`} v={-r.cleaningAlloc} />
                          <Detail label={r.revCat > 0 ? `− Electricity: ${keys.elec_catering_share}% of ${keys.elec_per_night} €/day × ${r.days} d` : "(no catering — no allocation)"} v={r.revCat > 0 ? -r.elecCat : 0} />
                          <Detail label={`− Electricity: ${r.revCat > 0 ? 100 - keys.elec_catering_share : 100}% of ${keys.elec_per_night} €/day × ${r.days} d`} v={-r.elecVenue} />
                          <Detail label="= M2 catering" v={r.m2Cat} strong />
                          <Detail label={`− Gardening/pool/supplies: ${r.days}/${model.totalDays} of ${fmt(model.seasonOpsPool)}`} v={-r.seasonAlloc} />
                          <div />
                          <Detail label={`− Events insurance: 1/${model.nEvents} of ${fmt(model.insurancePool)}`} v={-r.insAlloc} />
                          <div />
                          <Detail label={`− Recurring maintenance: ${r.days}/${model.totalDays} of ${fmt(model.maintPool)}`} v={-r.maintAlloc} />
                          <div />
                          <Detail label="= M2 venue" v={r.m2Venue} strong />
                          <div />
                        </div>
                        <div className="mt-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
                          Indicative, full-year view: M2 {fmt(r.m2)} − structure {fmt(model.structurePerDay)}/day × {r.days} d =
                          <span className={`font-semibold ml-1 ${r.m3 < 0 ? "text-[#B3261E]" : "text-foreground"}`}>{fmt(r.m3)}</span> (M3 — never judge a single event on this)
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Margins are net of VAT. Direct costs come from transactions linked to each event in the Transactions tab —
        the more you link, the more accurate M1 gets. Click a row for the full calculation.
      </p>
      </>
      )}
    </div>
  );
}

function Detail({ label, v, strong }: { label: string; v: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "font-semibold border-t border-border/50 pt-0.5" : ""}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="whitespace-nowrap tabular-nums">{v === 0 && !strong ? "—" : fmt(v)}</span>
    </div>
  );
}
