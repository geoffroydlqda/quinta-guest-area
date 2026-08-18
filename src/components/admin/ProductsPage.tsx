import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Package } from "lucide-react";

/**
 * Onglet Products (12 août 2026) — catalogue des services facturables
 * (massages, dégustations, ménage extra, nuits supplémentaires…).
 * Chaque produit : nom, catégorie de paiement (rental/catering/extra),
 * TVA par défaut, prix TTC par défaut (optionnel), unité, actif.
 * Les produits se sélectionnent ensuite à la création d'un paiement sur la
 * fiche guest — TVA et prix restent modifiables ligne par ligne.
 */
export type Product = {
  id: string; name: string; category: "rental" | "catering" | "extra";
  default_vat: number; default_price: number | null; unit: string | null;
  active: boolean; notes: string | null;
};

const CATEGORIES = ["extra", "catering", "rental"] as const;
const CAT_LABEL: Record<string, string> = { extra: "Extra", catering: "Catering", rental: "Rental" };
const VATS = [0, 6, 13, 23];

export function ProductsPage() {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);

  // Formulaire d'ajout
  const [nName, setNName] = useState("");
  const [nCat, setNCat] = useState<"rental" | "catering" | "extra">("extra");
  const [nVat, setNVat] = useState("23");
  const [nPrice, setNPrice] = useState("");
  const [nUnit, setNUnit] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("products").select("*").order("category").order("name");
    if (error) toast({ title: "Load failed", description: error.message, variant: "destructive" });
    setProducts((data || []) as Product[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!nName.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    setSaving(true);
    const { error } = await supabase.from("products").insert({
      name: nName.trim(), category: nCat, default_vat: Number(nVat),
      default_price: nPrice.trim() === "" ? null : Number(nPrice),
      unit: nUnit.trim() || null,
    });
    setSaving(false);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    setNName(""); setNPrice(""); setNUnit("");
    toast({ title: "Product added" });
    load();
  };

  const patch = async (id: string, p: Partial<Product>) => {
    setProducts((arr) => arr.map((x) => (x.id === id ? { ...x, ...p } : x)));
    const { error } = await supabase.from("products").update({ ...p, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); load(); }
  };

  const remove = async (p: Product) => {
    if (!window.confirm(`Delete "${p.name}"? Existing payments keep their lines — only the catalog entry is removed.`)) return;
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    load();
  };

  const visible = products.filter((p) => showInactive || p.active);

  return (
    <div className="space-y-4">
      {/* Ajout */}
      <div className="rounded-2xl border border-primary/50 bg-primary/5 p-3 flex flex-wrap items-end gap-2 text-sm">
        <label className="space-y-0.5 flex-1 min-w-[180px]">
          <div className="text-[11px] text-muted-foreground">Name *</div>
          <Input value={nName} onChange={(e) => setNName(e.target.value)} placeholder="Massage (60 min)" className="h-9 placeholder:italic placeholder:text-muted-foreground/50" />
        </label>
        <label className="space-y-0.5">
          <div className="text-[11px] text-muted-foreground">Category</div>
          <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={nCat} onChange={(e) => setNCat(e.target.value as typeof nCat)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
          </select>
        </label>
        <label className="space-y-0.5">
          <div className="text-[11px] text-muted-foreground">Default VAT</div>
          <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={nVat} onChange={(e) => setNVat(e.target.value)}>
            {VATS.map((v) => <option key={v} value={v}>{v}%</option>)}
          </select>
        </label>
        <label className="space-y-0.5">
          <div className="text-[11px] text-muted-foreground">Default price (€ incl. VAT)</div>
          <Input type="number" min="0" step="0.01" value={nPrice} onChange={(e) => setNPrice(e.target.value)} placeholder="80" className="h-9 w-28 placeholder:italic placeholder:text-muted-foreground/50" />
        </label>
        <label className="space-y-0.5">
          <div className="text-[11px] text-muted-foreground">Unit</div>
          <Input value={nUnit} onChange={(e) => setNUnit(e.target.value)} placeholder="per person" className="h-9 w-28 placeholder:italic placeholder:text-muted-foreground/50" />
        </label>
        <Button size="sm" className="h-9" onClick={add} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1" /> Add product</>}
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Products are picked when creating a payment on a guest's file — default VAT and price stay editable on each line.
        </p>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-3.5 w-3.5 accent-[#35532A]" />
          Show inactive
        </label>
      </div>

      {/* Liste */}
      <div className="overflow-auto rounded-2xl bg-card shadow-sm border border-border/60">
        <table className="w-full text-sm">
          <thead className="bg-muted/80">
            <tr className="text-left">
              {["Product", "Category", "Default VAT", "Default price", "Unit", "Active", ""].map((h, i) => (
                <th key={i} className="px-3 py-2.5 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-muted-foreground" /></td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground italic">
                <Package className="w-5 h-5 inline mr-1.5 -mt-0.5" /> No products yet — add your first service above (massage, wine tasting, extra cleaning…).
              </td></tr>
            ) : visible.map((p) => (
              <tr key={p.id} className={`border-t border-border/60 ${!p.active ? "opacity-50" : ""}`}>
                <td className="px-3 py-2">
                  <Input value={p.name} onChange={(e) => patch(p.id, { name: e.target.value })} className="h-8 min-w-[180px]" />
                </td>
                <td className="px-3 py-2">
                  <select className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={p.category} onChange={(e) => patch(p.id, { category: e.target.value as Product["category"] })}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={String(p.default_vat)} onChange={(e) => patch(p.id, { default_vat: Number(e.target.value) })}>
                    {VATS.map((v) => <option key={v} value={v}>{v}%</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <Input type="number" min="0" step="0.01" value={p.default_price != null ? String(p.default_price) : ""}
                    placeholder="free"
                    onChange={(e) => patch(p.id, { default_price: e.target.value === "" ? null : Number(e.target.value) })}
                    className="h-8 w-24 text-right placeholder:italic placeholder:text-muted-foreground/50" />
                </td>
                <td className="px-3 py-2">
                  <Input value={p.unit ?? ""} placeholder="—"
                    onChange={(e) => patch(p.id, { unit: e.target.value || null })}
                    className="h-8 w-28 placeholder:text-muted-foreground/50" />
                </td>
                <td className="px-3 py-2">
                  <button type="button"
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.active ? "bg-[#E5F5EA] text-[#178A3F]" : "bg-muted text-muted-foreground"}`}
                    title={p.active ? "Click to deactivate (hidden from payment forms, history kept)" : "Click to reactivate"}
                    onClick={() => patch(p.id, { active: !p.active })}>
                    {p.active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  <button type="button" className="text-[11px] text-muted-foreground/60 hover:text-destructive hover:underline"
                    onClick={() => remove(p)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
