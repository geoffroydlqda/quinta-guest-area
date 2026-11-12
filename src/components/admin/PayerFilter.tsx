import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

// Filtre multi-sélection des payeurs (12 nov 2026, demande Geoffroy) : ouvert
// depuis l'en-tête "Payer" du tableau Finance > Transactions. Les options
// viennent des transactions chargées (avec compteur) ; "__none__" = lignes sans
// payeur (virements, entrées). Sélection vide = pas de filtre.
export const NO_PAYER = "__none__";

export function PayerFilter({
  payers, value, onChange,
}: {
  payers: { value: string; count: number }[]; // value = payer ou NO_PAYER
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const label = (v: string) => (v === NO_PAYER ? "No payer (transfers, money in…)" : v);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? payers.filter((p) => label(p.value).toLowerCase().includes(s)) : payers;
  }, [payers, q]);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const active = value.length > 0;

  return (
    <Popover onOpenChange={(o) => { if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button type="button"
          className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground ${active ? "text-[#6D7855]" : ""}`}
          title="Filter by payer (one or several)">
          Payer{active ? ` (${value.length})` : ""} <ChevronDown className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2 normal-case tracking-normal">
        <div className="mb-2 flex items-center gap-2 rounded-md border border-input px-2">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input className="h-8 w-full bg-transparent text-sm outline-none" placeholder="Search payer…"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {shown.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">No payer found.</p>}
          {shown.map((p) => (
            <label key={p.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
              <Checkbox checked={value.includes(p.value)} onCheckedChange={() => toggle(p.value)} />
              <span className={`flex-1 truncate ${p.value === NO_PAYER ? "italic text-muted-foreground" : ""}`} title={label(p.value)}>{label(p.value)}</span>
              <span className="text-[11px] tabular-nums text-muted-foreground">{p.count}</span>
            </label>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs">
          <button type="button" className="text-muted-foreground hover:underline"
            onClick={() => onChange(shown.map((p) => p.value))}>Select all{q ? " shown" : ""}</button>
          <button type="button" className="text-muted-foreground hover:underline disabled:opacity-40"
            disabled={!active} onClick={() => onChange([])}>Clear</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
