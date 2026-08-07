// Dates "métier" : la Quinta vit en Europe/Lisbon. Toujours comparer les
// échéances/séjours au jour de Lisbonne, jamais au jour UTC du navigateur
// (entre minuit et 1 h d'été, les deux divergent d'un jour).
const LISBON_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" });

/** Jour courant à Lisbonne, au format YYYY-MM-DD. */
export function todayLisbon(): string {
  return LISBON_FMT.format(new Date());
}

/** YYYY-MM-DD local (sans passage par UTC) pour une Date construite en local. */
export function localIsoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
