import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * Champs enrichis de la fiche guest :
 * - AddressAutocomplete : autocomplétion d'adresse (Photon / OpenStreetMap,
 *   gratuit, sans clé API) — la sélection remplit rue, code postal, ville, pays.
 * - NationalityCombobox : recherche dans une liste de nationalités, texte libre permis.
 * Style commun : placeholders en italique clair pour les distinguer des valeurs.
 */

export const PLACEHOLDER_CLS = "h-9 placeholder:italic placeholder:text-muted-foreground/50";

// ------------------------------------------------------------------ adresse

type AddressParts = { street: string; zip: string; city: string; country: string };

type PhotonFeature = {
  properties: {
    housenumber?: string; street?: string; name?: string;
    postcode?: string; city?: string; town?: string; village?: string;
    country?: string;
  };
};

function featureToParts(f: PhotonFeature): AddressParts {
  const p = f.properties;
  const street = [p.street ?? p.name, p.housenumber].filter(Boolean).join(" ");
  return {
    street,
    zip: p.postcode ?? "",
    city: p.city ?? p.town ?? p.village ?? "",
    country: p.country ?? "",
  };
}

function featureLabel(f: PhotonFeature): string {
  const a = featureToParts(f);
  return [a.street, [a.zip, a.city].filter(Boolean).join(" "), a.country].filter(Boolean).join(", ");
}

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (parts: AddressParts) => void;
}) {
  const [suggestions, setSuggestions] = useState<PhotonFeature[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNext = useRef(false);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (skipNext.current) { skipNext.current = false; return; }
    const q = value.trim();
    if (q.length < 3) { setSuggestions([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=en`);
        const b = await r.json();
        const feats: PhotonFeature[] = (b?.features ?? []).filter((f: PhotonFeature) =>
          f.properties?.street || f.properties?.name
        );
        setSuggestions(feats);
        setOpen(feats.length > 0);
      } catch {
        setSuggestions([]); setOpen(false);
      }
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative">
      <Input
        value={value}
        placeholder="Start typing the address…"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={PLACEHOLDER_CLS}
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-border bg-popover shadow-md overflow-hidden">
          {suggestions.map((f, i) => (
            <button
              key={i}
              type="button"
              className="block w-full text-left px-3 py-2 text-sm hover:bg-muted"
              onMouseDown={(e) => {
                e.preventDefault();
                skipNext.current = true;
                onSelect(featureToParts(f));
                setOpen(false);
              }}
            >
              {featureLabel(f)}
            </button>
          ))}
          <div className="px-3 py-1 text-[10px] text-muted-foreground border-t border-border">
            Suggestions © OpenStreetMap
          </div>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------- nationalité

// Choix par PAYS (avec drapeau) — demande Geoffroy 31 juil. 2026.
const COUNTRIES: [string, string][] = [
  ["AR","Argentina"],["AU","Australia"],["AT","Austria"],["BE","Belgium"],["BR","Brazil"],
  ["BG","Bulgaria"],["CA","Canada"],["CL","Chile"],["CN","China"],["CO","Colombia"],
  ["HR","Croatia"],["CY","Cyprus"],["CZ","Czechia"],["DK","Denmark"],["EG","Egypt"],
  ["EE","Estonia"],["FI","Finland"],["FR","France"],["DE","Germany"],["GR","Greece"],
  ["HU","Hungary"],["IS","Iceland"],["IN","India"],["ID","Indonesia"],["IE","Ireland"],
  ["IL","Israel"],["IT","Italy"],["JP","Japan"],["LV","Latvia"],["LB","Lebanon"],
  ["LT","Lithuania"],["LU","Luxembourg"],["MT","Malta"],["MX","Mexico"],["MA","Morocco"],
  ["NL","Netherlands"],["NZ","New Zealand"],["NO","Norway"],["PE","Peru"],["PH","Philippines"],
  ["PL","Poland"],["PT","Portugal"],["RO","Romania"],["RU","Russia"],["SG","Singapore"],
  ["SK","Slovakia"],["SI","Slovenia"],["ZA","South Africa"],["KR","South Korea"],["ES","Spain"],
  ["SE","Sweden"],["CH","Switzerland"],["TH","Thailand"],["TN","Tunisia"],["TR","Turkey"],
  ["UA","Ukraine"],["AE","United Arab Emirates"],["GB","United Kingdom"],["US","United States"],
  ["UY","Uruguay"],["VN","Vietnam"],
];

const flagOf = (iso: string) =>
  String.fromCodePoint(...iso.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

export function NationalityCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const exact = COUNTRIES.find(([, n]) => n.toLowerCase() === q);
  const matches = q
    ? COUNTRIES.filter(([, n]) => n.toLowerCase().includes(q) && n.toLowerCase() !== q)
    : COUNTRIES;

  return (
    <div className="relative">
      {exact && (
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base pointer-events-none">
          {flagOf(exact[0])}
        </span>
      )}
      <Input
        value={value}
        placeholder="Search a country…"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={`${PLACEHOLDER_CLS} ${exact ? "pl-9" : ""}`}
      />
      {open && matches.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-52 overflow-auto rounded-md border border-border bg-popover shadow-md">
          {matches.map(([code, name]) => (
            <button
              key={code}
              type="button"
              className="flex w-full items-center gap-2 text-left px-3 py-1.5 text-sm hover:bg-muted"
              onMouseDown={(e) => { e.preventDefault(); onChange(name); setOpen(false); }}
            >
              <span className="text-base">{flagOf(code)}</span>
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
