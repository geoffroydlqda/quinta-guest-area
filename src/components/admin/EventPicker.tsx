import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown, X } from "lucide-react";

// Sélecteur d'événement avec recherche — remplace les <select> natifs devenus
// illisibles (50+ bookings). Tri ALPHABÉTIQUE, et par défaut (pastOnly) les
// événements de l'ANNÉE EN COURS et du passé apparaissent — les années
// futures (2027+) sont masquées : ces pickers servent à classer des dépenses
// et ventes de la saison courante (correctif du 1er sept 2026 : un event
// futur de l'année en cours doit être sélectionnable, p. ex. une dépense
// engagée avant un mariage d'octobre). Passer pastOnly={false} pour tout voir.
export type PickerEvent = {
  id: string;
  name: string;
  checkIn?: string | null; // ISO yyyy-mm-dd
  checkOut?: string | null;
};

const dd = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : null);

export function EventPicker({
  events, value, onChange, placeholder = "Link to an event…",
  pastOnly = true, allowNone = false, noneLabel = "No event", disabled = false, className = "",
}: {
  events: PickerEvent[];
  value: string; // "" = aucun
  onChange: (id: string) => void;
  placeholder?: string;
  pastOnly?: boolean;
  allowNone?: boolean; // affiche une entrée "No event" pour détacher
  noneLabel?: string; // libellé de cette entrée ("All events" pour un filtre)
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
    // focus la recherche à l'ouverture
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // pastOnly = passé + année en cours (les années futures sont masquées)
  const thisYear = new Date().toISOString().slice(0, 4);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events
      .filter((e) => !pastOnly || !e.checkIn || e.checkIn.slice(0, 4) <= thisYear)
      .filter((e) => !needle || e.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [events, q, pastOnly, today]);

  const selected = events.find((e) => e.id === value) ?? null;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen((v) => !v); setQ(""); }}
        className="h-7 w-full max-w-[280px] rounded-md border border-input bg-background px-1.5 text-xs flex items-center justify-between gap-1 disabled:opacity-50"
      >
        <span className={`truncate text-left ${selected ? "" : "text-muted-foreground"}`}>
          {selected ? selected.name : placeholder}
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
              placeholder="Search event…"
              className="h-8 w-full bg-transparent text-xs outline-none placeholder:italic placeholder:text-muted-foreground/60"
            />
            {q && (
              <button type="button" onClick={() => setQ("")} className="text-muted-foreground/60 hover:text-foreground">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="max-h-56 overflow-auto py-1">
            {allowNone && !q && (
              <button type="button"
                className="w-full px-2.5 py-1.5 text-left text-xs text-muted-foreground italic hover:bg-muted/60"
                onClick={() => { onChange(""); setOpen(false); }}>
                {noneLabel}
              </button>
            )}
            {list.length === 0 ? (
              <div className="px-2.5 py-3 text-center text-xs text-muted-foreground italic">
                No event matches
              </div>
            ) : list.map((e) => (
              <button key={e.id} type="button"
                className={`w-full px-2.5 py-1.5 text-left text-xs hover:bg-muted/60 flex items-baseline justify-between gap-2 ${e.id === value ? "bg-primary/5 font-medium" : ""}`}
                onClick={() => { onChange(e.id); setOpen(false); }}>
                <span className="truncate">{e.name}</span>
                {dd(e.checkIn) && (
                  <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                    {dd(e.checkIn)}{dd(e.checkOut) ? ` → ${dd(e.checkOut)}` : ""}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
