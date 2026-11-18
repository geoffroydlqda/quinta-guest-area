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

const KEY = "qda-admin-property";
const EVT = "qda-property-change";

export function getProperty(): Property {
  try {
    return localStorage.getItem(KEY) === "terra" ? "terra" : "quinta";
  } catch {
    return "quinta";
  }
}

export function setProperty(p: Property) {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* stockage indisponible : l'état mémoire suffit pour la session */
  }
  window.dispatchEvent(new CustomEvent(EVT, { detail: p }));
}

/** Lieu courant de l'admin, réactif au switcher où qu'il soit monté. */
export function useProperty(): [Property, (p: Property) => void] {
  const [prop, setProp] = useState<Property>(getProperty);
  useEffect(() => {
    const onChange = () => setProp(getProperty());
    window.addEventListener(EVT, onChange);
    return () => window.removeEventListener(EVT, onChange);
  }, []);
  return [prop, setProperty];
}

/** Lieu d'un booking, tolérant aux lignes d'avant la migration. */
export function bookingProperty(b: { property?: string | null } | null | undefined): Property {
  return b?.property === "terra" ? "terra" : "quinta";
}
