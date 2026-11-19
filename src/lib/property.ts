// Multi-lieux (phase 0, 18 nov 2026) — Grupo OHM opère deux lieux :
// Quinta do Amor ('quinta') et Terra da Paz ('terra'). Le lieu sélectionné
// dans l'admin est global (switcher dans AdminLayout), persisté en local et
// partagé entre composants via un event — même pattern que le dark mode.
// Plan complet : claude/plan-multi-lieux-2026-11.md (doc projet).
import { useEffect, useState } from "react";

export type Property = "quinta" | "terra";

export const PROPERTIES: Property[] = ["quinta", "terra"];

export const PROPERTY_LABEL: Record<Property, string> = {
  quinta: "Quinta do Amor",
  terra: "Terra da Paz",
};

export const PROPERTY_SHORT: Record<Property, string> = {
  quinta: "QDA",
  terra: "TDP",
};

// Le switcher a trois positions (P0b, 18 nov 2026) : un lieu précis, ou "all"
// (vue consolidée Grupo OHM — aucun filtre). Les actions qui exigent un lieu
// concret (création de booking…) passent par getProperty(), qui retombe sur
// 'quinta' quand le filtre est sur All.
export type PropertyFilter = Property | "all";

export const FILTER_LABEL: Record<PropertyFilter, string> = {
  ...PROPERTY_LABEL,
  all: "Grupo OHM",
};

export const FILTER_SHORT: Record<PropertyFilter, string> = {
  ...PROPERTY_SHORT,
  all: "All",
};

const KEY = "qda-admin-property";
const EVT = "qda-property-change";

export function getPropertyFilter(): PropertyFilter {
  try {
    const v = localStorage.getItem(KEY);
    return v === "terra" ? "terra" : v === "all" ? "all" : "quinta";
  } catch {
    return "quinta";
  }
}

/** Lieu concret pour les actions (création…) : All → quinta. */
export function getProperty(): Property {
  const f = getPropertyFilter();
  return f === "terra" ? "terra" : "quinta";
}

export function setPropertyFilter(p: PropertyFilter) {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* stockage indisponible : l'état mémoire suffit pour la session */
  }
  window.dispatchEvent(new CustomEvent(EVT, { detail: p }));
}

/** Filtre courant de l'admin (lieu ou All), réactif au switcher. */
export function usePropertyFilter(): [PropertyFilter, (p: PropertyFilter) => void] {
  const [prop, setProp] = useState<PropertyFilter>(getPropertyFilter);
  useEffect(() => {
    const onChange = () => setProp(getPropertyFilter());
    window.addEventListener(EVT, onChange);
    return () => window.removeEventListener(EVT, onChange);
  }, []);
  return [prop, setPropertyFilter];
}

/** Lieu d'un booking, tolérant aux lignes d'avant la migration. */
export function bookingProperty(b: { property?: string | null } | null | undefined): Property {
  return b?.property === "terra" ? "terra" : "quinta";
}

// ---------------------------------------------------------------------------
// Guest area multi-lieux (P4a, 19 nov 2026).
// Le lieu de la GUEST AREA ne vient pas d'un switcher : il est déterminé par
// le domaine — guest.terradapaz.com = Terra da Paz, tout le reste = Quinta.
// Pour tester avant que le domaine existe : ?property=terra dans l'URL
// (mémorisé pour la session de l'onglet, previews Vercel incluses).
// ---------------------------------------------------------------------------
const GUEST_KEY = "qda-guest-property";

export function guestProperty(): Property {
  try {
    const qs = new URLSearchParams(window.location.search).get("property");
    if (qs === "terra" || qs === "quinta") {
      try { sessionStorage.setItem(GUEST_KEY, qs); } catch { /* storage indisponible */ }
      return qs;
    }
    const saved = sessionStorage.getItem(GUEST_KEY);
    if (saved === "terra" || saved === "quinta") return saved as Property;
    if (window.location.hostname.toLowerCase().endsWith("terradapaz.com")) return "terra";
  } catch { /* SSR / URL inaccessible */ }
  return "quinta";
}

/** Nom affiché du lieu de la guest area (wordmark, footers, alt text…). */
export function guestBrandName(): string {
  return PROPERTY_LABEL[guestProperty()];
}
