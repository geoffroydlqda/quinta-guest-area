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

const NATIONALITIES = [
  "American", "Argentine", "Australian", "Austrian", "Belgian", "Brazilian", "British",
  "Bulgarian", "Canadian", "Chilean", "Chinese", "Colombian", "Croatian", "Cypriot",
  "Czech", "Danish", "Dutch", "Egyptian", "Estonian", "Filipino", "Finnish", "French",
  "German", "Greek", "Hungarian", "Icelandic", "Indian", "Indonesian", "Irish",
  "Israeli", "Italian", "Japanese", "Latvian", "Lebanese", "Lithuanian",
  "Luxembourgish", "Maltese", "Mexican", "Moroccan", "New Zealander", "Norwegian",
  "Peruvian", "Polish", "Portuguese", "Romanian", "Russian", "Singaporean", "Slovak",
  "Slovenian", "South African", "South Korean", "Spanish", "Swedish", "Swiss", "Thai",
  "Tunisian", "Turkish", "Ukrainian", "Uruguayan", "Vietnamese",
];

export function NationalityCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const matches = q
    ? NATIONALITIES.filter((n) => n.toLowerCase().includes(q) && n.toLowerCase() !== q)
    : NATIONALITIES;

  return (
    <div className="relative">
      <Input
        value={value}
        placeholder="Search — e.g. Belgian"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={PLACEHOLDER_CLS}
      />
      {open && matches.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-52 overflow-auto rounded-md border border-border bg-popover shadow-md">
          {matches.map((n) => (
            <button
              key={n}
              type="button"
              className="block w-full text-left px-3 py-1.5 text-sm hover:bg-muted"
              onMouseDown={(e) => { e.preventDefault(); onChange(n); setOpen(false); }}
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
