import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayLisbon } from "@/lib/dates";
import { Loader2, Plus, Minus, ClipboardList, ShoppingCart, Boxes, Settings2, Check, Trash2 } from "lucide-react";

/**
 * Onglet Operations > Inventory (12 nov 2026, demande Geoffroy).
 * Systeme PAR-stock simplifie, inspire des inventaires housekeeping hoteliers :
 * - references approuvees : UNE reference exacte par besoin (anti "on achete
 *   une marque differente a chaque fois") — champ libre rempli par Geoffroy ;
 * - par (stock cible) + reorder_point (seuil) -> statut OK / Low / Out calcule ;
 * - comptage guide la VEILLE de chaque evenement (jour tampon sans client),
 *   lieu par lieu, sur telephone — horodate et signe ;
 * - shopping list automatique groupee par fournisseur (quantite = par - stock).
 * Les alertes (rappel Luis a J-1, escalade Geoffroy) sont portees par
 * l'Edge Function inventory-reminder (cron quotidien).
 */

type Item = {
  id: string; name: string; reference: string | null; supplier: string | null;
  category: string; location: string; unit: string | null;
  par: number; reorder_point: number; current_qty: number | null;
  last_counted_at: string | null; last_counted_by: string | null;
  notes: string | null; active: boolean; sort_order: number;
};

type ItemStatus = "out" | "low" | "ok" | "uncounted";

const statusOf = (it: Item): ItemStatus => {
  if (it.current_qty === null || it.current_qty === undefined) return "uncounted";
  if (Number(it.current_qty) <= 0) return "out";
  if (Number(it.current_qty) <= Number(it.reorder_point)) return "low";
  return "ok";
};

const STATUS_CHIP: Record<ItemStatus, { label: string; cls: string }> = {
  ok: { label: "OK", cls: "bg-secondary text-secondary-foreground" },
  low: { label: "Low", cls: "bg-amber-100 text-amber-700" },
  out: { label: "Out", cls: "bg-red-100 text-red-600" },
  uncounted: { label: "Not counted", cls: "bg-muted text-muted-foreground" },
};

const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";

export function InventoryPage() {
  const { toast } = useToast();
  const { user } = useAuth();

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"stock" | "shopping" | "count" | "items">("stock");
  const [busy, setBusy] = useState(false);

  // Prochain evenement (pour la logique "comptage la veille").
  const [nextEvent, setNextEvent] = useState<{ id: string; retreat_name: string; check_in_date: string } | null>(null);
  const [lastCount, setLastCount] = useState<{ completed_at: string; counted_by: string | null } | null>(null);

  // Count mode
  const [counting, setCounting] = useState(false);
  const [countQty, setCountQty] = useState<Record<string, number>>({});

  // Items & settings
  const [showAdd, setShowAdd] = useState(false);
  const emptyDraft = { name: "", reference: "", supplier: "", location: "Cleaning cupboard", unit: "", par: "2", reorder_point: "1" };
  const [draft, setDraft] = useState(emptyDraft);

  const load = async () => {
    const today = todayLisbon();
    const [itemsRes, bookingRes, countRes] = await Promise.all([
      supabase.from("inventory_items").select("*").order("location").order("sort_order").order("name"),
      supabase.from("bookings")
        .select("id,retreat_name,check_in_date")
        .gte("check_in_date", today).eq("is_test", false).is("cancelled_at", null)
        .order("check_in_date", { ascending: true }).limit(1),
      supabase.from("inventory_counts")
        .select("completed_at,counted_by").not("completed_at", "is", null)
        .order("completed_at", { ascending: false }).limit(1),
    ]);
    if (itemsRes.error) toast({ title: "Failed to load inventory", description: itemsRes.error.message, variant: "destructive" });
    setItems((itemsRes.data as Item[] | null) ?? []);
    setNextEvent((bookingRes.data?.[0] as typeof nextEvent) ?? null);
    const lc = countRes.data?.[0];
    setLastCount(lc ? { completed_at: lc.completed_at as string, counted_by: lc.counted_by as string | null } : null);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const active = useMemo(() => items.filter((i) => i.active), [items]);

  const kpis = useMemo(() => {
    const by: Record<ItemStatus, number> = { out: 0, low: 0, ok: 0, uncounted: 0 };
    active.forEach((i) => { by[statusOf(i)] += 1; });
    return by;
  }, [active]);

  // Comptage attendu ? (la veille du prochain evenement, ou le jour J si pas fait)
  const countDue = useMemo(() => {
    if (!nextEvent) return null;
    const today = todayLisbon();
    const dayBefore = new Date(`${nextEvent.check_in_date}T12:00:00`);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const dueDay = dayBefore.toISOString().slice(0, 10);
    if (today < dueDay) return { phase: "upcoming" as const, dueDay };
    // J-1 ou plus tard : un comptage termine depuis le jour "due" compte.
    const done = lastCount && lastCount.completed_at.slice(0, 10) >= dueDay;
    if (done) return { phase: "done" as const, dueDay };
    return { phase: today === dueDay ? ("due" as const) : ("overdue" as const), dueDay };
  }, [nextEvent, lastCount]);

  const shopping = useMemo(() => {
    const need = active.filter((i) => ["out", "low"].includes(statusOf(i)));
    const groups = new Map<string, Item[]>();
    need.forEach((i) => {
      const k = i.supplier?.trim() || "No supplier set";
      groups.set(k, [...(groups.get(k) ?? []), i]);
    });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [active]);

  const buyQty = (i: Item) => Math.max(1, Math.ceil(Number(i.par) - Number(i.current_qty ?? 0)));

  const locations = useMemo(() => {
    const groups = new Map<string, Item[]>();
    active.forEach((i) => groups.set(i.location, [...(groups.get(i.location) ?? []), i]));
    return [...groups.entries()];
  }, [active]);

  const counterName = () => {
    const email = user?.email ?? "";
    return email.split("@")[0] || "admin";
  };

  /* ---------- actions ---------- */

  const startCount = () => {
    const init: Record<string, number> = {};
    active.forEach((i) => { init[i.id] = Number(i.current_qty ?? 0); });
    setCountQty(init);
    setCounting(true);
    setView("count");
  };

  const finishCount = async () => {
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const { data: count, error: cErr } = await supabase.from("inventory_counts")
        .insert({ completed_at: now, counted_by: counterName(), booking_id: countDue && countDue.phase !== "upcoming" ? nextEvent?.id ?? null : null })
        .select("id").single();
      if (cErr) throw cErr;
      const lines = active.map((i) => ({ count_id: count.id, item_id: i.id, qty: countQty[i.id] ?? 0 }));
      const { error: lErr } = await supabase.from("inventory_count_lines").insert(lines);
      if (lErr) throw lErr;
      await Promise.all(active.map((i) =>
        supabase.from("inventory_items")
          .update({ current_qty: countQty[i.id] ?? 0, last_counted_at: now, last_counted_by: counterName(), updated_at: now })
          .eq("id", i.id)
      ));
      toast({ title: "Count saved", description: `${lines.length} items counted.` });
      setCounting(false);
      setView("stock");
      await load();
    } catch (e) {
      toast({ title: "Count failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const restock = async (ids: string[]) => {
    setBusy(true);
    const now = new Date().toISOString();
    await Promise.all(ids.map((id) => {
      const it = items.find((i) => i.id === id);
      return supabase.from("inventory_items")
        .update({ current_qty: it ? Number(it.par) : 0, updated_at: now }).eq("id", id);
    }));
    setBusy(false);
    toast({ title: "Restocked", description: "Stock set back to par level." });
    await load();
  };

  const patchItem = async (id: string, p: Partial<Item>) => {
    setItems((arr) => arr.map((i) => (i.id === id ? { ...i, ...p } : i)));
    const { error } = await supabase.from("inventory_items")
      .update({ ...p, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); load(); }
  };

  const addItem = async () => {
    if (!draft.name.trim()) return;
    const { error } = await supabase.from("inventory_items").insert({
      name: draft.name.trim(), reference: draft.reference.trim() || null,
      supplier: draft.supplier.trim() || null, location: draft.location.trim() || "Storage",
      unit: draft.unit.trim() || null, par: Number(draft.par) || 1,
      reorder_point: Number(draft.reorder_point) || 0, sort_order: 500,
    });
    if (error) { toast({ title: "Add failed", description: error.message, variant: "destructive" }); return; }
    setDraft(emptyDraft); setShowAdd(false); await load();
  };

  const deleteItem = async (id: string) => {
    const { error } = await supabase.from("inventory_items").delete().eq("id", id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    await load();
  };

  /* ---------- render ---------- */

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const pill = (key: typeof view, label: string, icon: ReactNode) => (
    <button key={key}
      onClick={() => { setView(key); if (key !== "count") setCounting(false); if (key === "count" && !counting) startCount(); }}
      className={`flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm transition-colors ${
        view === key ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card text-foreground/70 hover:bg-secondary"
      }`}>
      {icon}{label}
    </button>
  );

  const shoppingCount = shopping.reduce((n, [, arr]) => n + arr.length, 0);

  return (
    <div className="space-y-4">
      {/* Bandeau comptage */}
      {countDue?.phase === "due" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          🧮 <b>Count due today</b> — {nextEvent?.retreat_name} arrives tomorrow ({fmtDay(nextEvent?.check_in_date ?? null)}). Buffer day: count the stock and restock what's missing.
        </div>
      )}
      {countDue?.phase === "overdue" && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          ⏰ <b>Count overdue</b> — {nextEvent?.retreat_name} arrives {fmtDay(nextEvent?.check_in_date ?? null)} and the pre-event count hasn't been done.
        </div>
      )}
      {countDue?.phase === "done" && (
        <div className="rounded-xl border border-border bg-secondary/60 px-4 py-3 text-sm text-secondary-foreground">
          ✅ Pre-event count done {lastCount ? `on ${fmtDay(lastCount.completed_at)} by ${lastCount.counted_by ?? "?"}` : ""} — {nextEvent?.retreat_name} arrives {fmtDay(nextEvent?.check_in_date ?? null)}.
        </div>
      )}
      {countDue?.phase === "upcoming" && nextEvent && (
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Next event: <b className="text-foreground">{nextEvent.retreat_name}</b> on {fmtDay(nextEvent.check_in_date)} — count due on the buffer day ({fmtDay(countDue.dueDay)}).
          {lastCount && <> Last count: {fmtDay(lastCount.completed_at)} by {lastCount.counted_by ?? "?"}.</>}
        </div>
      )}

      {/* KPIs */}
      <div className="flex flex-wrap gap-2.5">
        {[
          { n: kpis.out, l: "Out of stock", cls: "text-destructive" },
          { n: kpis.low, l: "Running low", cls: "text-amber-600" },
          { n: kpis.ok, l: "In stock", cls: "text-success" },
          { n: kpis.uncounted, l: "Never counted", cls: "text-muted-foreground" },
        ].map((k) => (
          <div key={k.l} className="min-w-[130px] rounded-xl border border-border bg-card px-4 py-2.5">
            <div className={`text-xl font-bold ${k.cls}`}>{k.n}</div>
            <div className="text-xs text-muted-foreground">{k.l}</div>
          </div>
        ))}
      </div>

      {/* Pills */}
      <div className="flex flex-wrap gap-2">
        {pill("stock", "Stock", <Boxes className="h-3.5 w-3.5" />)}
        {pill("shopping", `Shopping list${shoppingCount ? ` (${shoppingCount})` : ""}`, <ShoppingCart className="h-3.5 w-3.5" />)}
        {pill("count", counting ? "Counting…" : "Start count", <ClipboardList className="h-3.5 w-3.5" />)}
        {pill("items", "Items & settings", <Settings2 className="h-3.5 w-3.5" />)}
      </div>

      {/* ---------- STOCK ---------- */}
      {view === "stock" && locations.map(([loc, arr]) => (
        <div key={loc} className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{loc}</span>
            <span className="text-xs text-muted-foreground">
              {arr.some((i) => i.last_counted_at) ? `counted ${fmtDay(arr.map((i) => i.last_counted_at).sort().reverse()[0] ?? null)}` : "never counted"}
            </span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {arr.map((i) => {
                const st = statusOf(i);
                const pct = i.current_qty === null ? 0 : Math.min(100, Math.round((Number(i.current_qty) / Number(i.par)) * 100));
                return (
                  <tr key={i.id} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold">{i.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {i.reference || <span className="italic text-amber-600">no approved reference yet</span>}
                        {i.supplier ? ` · ${i.supplier}` : ""}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <b>{i.current_qty ?? "—"}</b> <span className="text-muted-foreground">/ {i.par} {i.unit ?? ""}</span>
                    </td>
                    <td className="hidden px-3 py-2.5 sm:table-cell">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                        <div className={`h-full rounded-full ${st === "ok" ? "bg-success" : st === "low" ? "bg-amber-400" : "bg-destructive"}`} style={{ width: `${Math.max(pct, 4)}%` }} />
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_CHIP[st].cls}`}>{STATUS_CHIP[st].label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {/* ---------- SHOPPING ---------- */}
      {view === "shopping" && (shoppingCount === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Nothing to buy — everything is at or above its reorder point. 🎉
        </div>
      ) : shopping.map(([supplier, arr]) => (
        <div key={supplier} className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{supplier} — {arr.length} item{arr.length > 1 ? "s" : ""}</span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => restock(arr.map((i) => i.id))}>
              <Check className="mr-1 h-3.5 w-3.5" /> Mark all restocked
            </Button>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {arr.map((i) => (
                <tr key={i.id} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold">{i.name}</div>
                    <div className="text-xs text-muted-foreground">{i.reference || <span className="italic text-amber-600">no approved reference yet</span>}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{i.current_qty ?? 0} → {i.par}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-bold">Buy {buyQty(i)} {i.unit ?? ""}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => restock([i.id])}>✓ Restocked</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )))}

      {/* ---------- COUNT ---------- */}
      {view === "count" && counting && (
        <div className="mx-auto max-w-lg space-y-4">
          {locations.map(([loc, arr]) => (
            <div key={loc} className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{loc}</div>
              <div className="space-y-2 p-3">
                {arr.map((i) => (
                  <div key={i.id} className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{i.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{i.reference || i.unit || ""}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-lg font-bold text-secondary-foreground"
                        onClick={() => setCountQty((q) => ({ ...q, [i.id]: Math.max(0, (q[i.id] ?? 0) - 1) }))}><Minus className="h-4 w-4" /></button>
                      <input type="number" min={0} value={countQty[i.id] ?? 0}
                        onChange={(e) => setCountQty((q) => ({ ...q, [i.id]: Math.max(0, Number(e.target.value) || 0) }))}
                        className="h-9 w-14 rounded-lg border border-border bg-card text-center text-base font-bold" />
                      <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-lg font-bold text-secondary-foreground"
                        onClick={() => setCountQty((q) => ({ ...q, [i.id]: (q[i.id] ?? 0) + 1 }))}><Plus className="h-4 w-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" disabled={busy} onClick={() => { setCounting(false); setView("stock"); }}>Cancel</Button>
            <Button className="flex-1" disabled={busy} onClick={finishCount}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />} Finish count
            </Button>
          </div>
        </div>
      )}

      {/* ---------- ITEMS & SETTINGS ---------- */}
      {view === "items" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              One <b>approved reference</b> per item (exact brand + pack + supplier) — this is what the shopping list shows.
            </p>
            <Button size="sm" onClick={() => setShowAdd((v) => !v)}><Plus className="mr-1 h-4 w-4" /> Add item</Button>
          </div>
          {showAdd && (
            <div className="grid gap-2 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Input placeholder="Name *" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <Input placeholder="Approved reference (brand, pack…)" value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} />
              <Input placeholder="Supplier" value={draft.supplier} onChange={(e) => setDraft({ ...draft, supplier: e.target.value })} />
              <Input placeholder="Location" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
              <Input placeholder="Unit (pack, bottle…)" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
              <Input placeholder="Par level" type="number" value={draft.par} onChange={(e) => setDraft({ ...draft, par: e.target.value })} />
              <Input placeholder="Reorder below" type="number" value={draft.reorder_point} onChange={(e) => setDraft({ ...draft, reorder_point: e.target.value })} />
              <Button onClick={addItem}>Add</Button>
            </div>
          )}
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[840px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Item</th><th className="px-3 py-2">Approved reference</th>
                  <th className="px-3 py-2">Supplier</th><th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Unit</th><th className="px-3 py-2">Par</th>
                  <th className="px-3 py-2">Reorder</th><th className="px-3 py-2">Active</th><th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className={`border-b border-border/50 last:border-0 ${i.active ? "" : "opacity-50"}`}>
                    <td className="px-3 py-1.5"><InlineText value={i.name} onSave={(v) => patchItem(i.id, { name: v })} /></td>
                    <td className="px-3 py-1.5"><InlineText value={i.reference ?? ""} placeholder="e.g. Renova Green, pack of 24" onSave={(v) => patchItem(i.id, { reference: v || null })} /></td>
                    <td className="px-3 py-1.5"><InlineText value={i.supplier ?? ""} placeholder="Makro…" onSave={(v) => patchItem(i.id, { supplier: v || null })} /></td>
                    <td className="px-3 py-1.5"><InlineText value={i.location} onSave={(v) => patchItem(i.id, { location: v || "Storage" })} /></td>
                    <td className="px-3 py-1.5"><InlineText value={i.unit ?? ""} onSave={(v) => patchItem(i.id, { unit: v || null })} /></td>
                    <td className="px-3 py-1.5 w-16"><InlineText value={String(i.par)} number onSave={(v) => patchItem(i.id, { par: Math.max(1, Number(v) || 1) })} /></td>
                    <td className="px-3 py-1.5 w-16"><InlineText value={String(i.reorder_point)} number onSave={(v) => patchItem(i.id, { reorder_point: Math.max(0, Number(v) || 0) })} /></td>
                    <td className="px-3 py-1.5">
                      <button onClick={() => patchItem(i.id, { active: !i.active })}
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${i.active ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"}`}>
                        {i.active ? "Active" : "Hidden"}
                      </button>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button className="text-muted-foreground hover:text-destructive" title="Delete item"
                        onClick={() => { if (confirm(`Delete "${i.name}"? Its count history goes too.`)) deleteItem(i.id); }}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function InlineText({ value, onSave, placeholder, number }: { value: string; onSave: (v: string) => void; placeholder?: string; number?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <input
      type={number ? "number" : "text"}
      className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-border focus:border-border focus:bg-card focus:outline-none"
      value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== value) onSave(v.trim()); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}
