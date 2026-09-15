import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown, X } from "lucide-react";

// Sélecteur de catégorie avec recherche (15 sept 2026) — même principe que
// EventPicker : remplace les <select> à optgroups devenus longs à parcourir
// (40+ catégories). Les groupes de FIN_CATEGORIES restent visibles comme
// en-têtes ; la recherche matche le nom de la catégorie OU celui du groupe.
// Les groupes sont passés en prop (pas d'import depuis FinancePage — éviter
// l'import circulaire).
export type CategoryGroup = { group: string; items: string[] };

export function CategoryPicker({
  groups, value, onChange, placeholder = "Category…",
  allowNone = false, noneLabel = "All categories",
  extra = [], pill = false, disabled = false, className = "",
}: {
  groups: CategoryGroup[];
  value: string; // "" = aucune
  onChange: (category: string) => void;
  placeholder?: string;
  allowNone?: boolean; // entrée pour vider la sélection (filtres)
  noneLabel?: string;
  extra?: { value: string; label: string }[]; // entrées spéciales (ex: __none__)
  pill?: boolean; // style rounded-full (barre de filtres)
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((g) => ({
        group: g.group,
        items: g.group.toLowerCase().includes(needle)
          ? g.items
          : g.items.filter((c) => c.toLowerCase().includes(needle)),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, q]);

  const extraLabel = extra.find((e) => e.value === value)?.label ?? null;
  const display = extraLabel ?? (value || null);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen((v) => !v); setQ(""); }}
        className={`h-7 w-full ${pill
          ? "rounded-full border border-border bg-card px-2.5"
          : "max-w-[230px] rounded-md border border-input bg-background px-1.5"} text-xs flex items-center justify-between gap-1 disabled:opacity-50`}
      >
        <span className={`truncate text-left ${display ? "" : "text-muted-foreground"}`}>
          {display ?? placeholder}
        </span>
        <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-72 rounded-lg border border-border bg-card shadow-lg overflow-hidden">
          <div className="flex items-center gap-1.5 border-b border-border/60 px-2">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search category…"
              className="h-8 w-full bg-transparent text-xs outline-none placeholder:italic placeholder:text-muted-foreground/60"
            />
            {q && (
              <button type="button" onClick={() => setQ("")} className="text-muted-foreground/60 hover:text-foreground">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-auto py-1">
            {allowNone && !q && (
              <button type="button"
                className="w-full px-2.5 py-1.5 text-left text-xs text-muted-foreground italic hover:bg-muted/60"
                onClick={() => { onChange(""); setOpen(false); }}>
                {noneLabel}
              </button>
            )}
            {!q && extra.map((e) => (
              <button key={e.value} type="button"
                className={`w-full px-2.5 py-1.5 text-left text-xs hover:bg-muted/60 ${e.value === value ? "bg-primary/5 font-medium" : ""}`}
                onClick={() => { onChange(e.value); setOpen(false); }}>
                {e.label}
              </button>
            ))}
            {filtered.length === 0 ? (
              <div className="px-2.5 py-3 text-center text-xs text-muted-foreground italic">
                No category matches
              </div>
            ) : filtered.map((g) => (
              <div key={g.group}>
                <div className="px-2.5 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  {g.group}
                </div>
                {g.items.map((c) => (
                  <button key={c} type="button"
                    className={`w-full px-2.5 py-1.5 text-left text-xs hover:bg-muted/60 ${c === value ? "bg-primary/5 font-medium" : ""}`}
                    onClick={() => { onChange(c); setOpen(false); }}>
                    {c}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
