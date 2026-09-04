// Fiche cuisine imprimable — "FOOD PLAN" brandé Quinta do Amor (1 août 2026).
// Inspirée du visuel validé par Geoffroy : bandeau restrictions, une carte par
// jour (repas, heure, effectifs par régime), clé de lecture en pied de page.
// Ouvre une fenêtre dédiée prête à imprimer (Cmd+P déclenché automatiquement).

type DaySel = {
  date: string;
  fullBoard?: boolean;
  breakfast?: boolean;
  lunch?: boolean;
  dinner?: boolean;
  guests_count_day?: number;
};

export type KitchenBooking = {
  retreat_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string;
  guest_count?: number | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
};

export type KitchenFoodPlan = {
  selections?: unknown;
  diet_config?: unknown;
  meal_times?: unknown;
  notes_food?: string | null;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const fmtLong = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long" }).toUpperCase();

const fmtRange = (a?: string | null, b?: string | null) => {
  if (!a || !b) return "";
  const f = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  return `${f(a)} → ${f(b)} ${new Date(`${b}T12:00:00`).getFullYear()}`;
};

export function openKitchenSheet(booking: KitchenBooking, plan: KitchenFoodPlan) {
  const name = booking.retreat_name || `${booking.first_name ?? ""} ${booking.last_name ?? ""}`.trim() || booking.email || "Event";
  const selections = (Array.isArray(plan.selections) ? plan.selections : []) as DaySel[];
  const dc = (plan.diet_config ?? {}) as Record<string, number>;
  const veg = Number(dc.vegetarian_count ?? 0);
  const meatDinner = Number(dc.meat_dinner_count ?? 0);
  const meatBoth = Number(dc.meat_lunch_dinner_count ?? 0);
  const mt = (plan.meal_times ?? {}) as Record<string, string>;
  // ⚠️ Le Food tool guest stocke les clés "breakfast_time"/"lunch_time"/
  // "dinner_time" — la fiche lisait "breakfast"/... et retombait TOUJOURS sur
  // les défauts (bug Root to rise, 2 sept 2026). On lit les deux formes.
  const timeOf = (k: string, dflt: string) => ((mt[`${k}_time`] || mt[k] || dflt) as string).slice(0, 5);
  const baseGuests = Number(booking.guest_count ?? 0);

  const days = [...selections]
    .filter((s) => s?.date && (s.fullBoard || s.breakfast || s.lunch || s.dinner))
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalMeals = days.reduce((sum, s) => {
    const on = (v?: boolean) => (s.fullBoard || v ? 1 : 0);
    const g = Number(s.guests_count_day ?? baseGuests) || 0;
    return sum + g * (on(s.breakfast) + on(s.lunch) + on(s.dinner));
  }, 0);

  const dayCard = (s: DaySel) => {
    const g = Number(s.guests_count_day ?? baseGuests) || 0;
    const isIn = s.date === booking.check_in_date;
    const isOut = s.date === booking.check_out_date;
    const tag = isIn ? "CHECK-IN DAY" : isOut ? "CHECK-OUT DAY" : s.fullBoard ? "FULL BOARD DAY" : "";
    const meals: { key: "breakfast" | "lunch" | "dinner"; label: string; icon: string; time: string; meat: number }[] = [];
    if (s.fullBoard || s.breakfast) meals.push({ key: "breakfast", label: "BREAKFAST", icon: "☀️", time: timeOf("breakfast", "08:30"), meat: 0 });
    if (s.fullBoard || s.lunch) meals.push({ key: "lunch", label: "LUNCH", icon: "🌤", time: timeOf("lunch", "13:00"), meat: meatBoth });
    if (s.fullBoard || s.dinner) meals.push({ key: "dinner", label: "DINNER", icon: "🌙", time: timeOf("dinner", "19:30"), meat: meatDinner + meatBoth });
    return `
    <div class="day">
      <div class="day-head"><div class="day-date">${esc(fmtLong(s.date))}</div>${tag ? `<div class="day-tag">${tag}</div>` : ""}</div>
      <table class="meals">
        <tr class="cols"><th></th><th>👥</th><th>🌿 veg</th><th>🍖 meat</th></tr>
        ${meals.map((m) => `
        <tr>
          <td class="meal"><span class="ic">${m.icon}</span><b>${m.label}</b><span class="tm">${m.time}</span></td>
          <td class="n total">${g}</td>
          <td class="n">${veg || "–"}</td>
          <td class="n">${m.key === "breakfast" ? "–" : (m.meat || "–")}</td>
        </tr>`).join("")}
      </table>
      ${isIn ? `<div class="day-note">🌿 No lunch or breakfast on check-in day</div>` : ""}
      ${isOut ? `<div class="day-note">🌿 Breakfast only on check-out day</div>` : ""}
    </div>`;
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Food plan — ${esc(name)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Inter',system-ui,sans-serif; background:#FCF7F0; color:#31352E; padding:34px 38px; }
  .brand { text-align:center; letter-spacing:.28em; font-weight:600; font-size:19px; color:#3d4a33; }
  .brand .heart { color:#D96A3B; letter-spacing:0; }
  h1 { text-align:center; font-size:27px; font-weight:800; letter-spacing:.04em; color:#3d4a33; margin-top:14px; text-transform:uppercase; }
  .sub { text-align:center; color:#D96A3B; font-weight:600; font-size:14px; margin-top:6px; }
  .panel { border:1.5px solid #E3B48F; border-radius:14px; padding:14px 18px; margin-top:22px; display:flex; gap:18px; align-items:flex-start; background:#fff9f2aa; }
  .panel .t { font-size:12px; font-weight:700; letter-spacing:.12em; color:#3d4a33; text-transform:uppercase; width:110px; flex-shrink:0; padding-top:2px; }
  .panel .items { display:flex; gap:22px; flex-wrap:wrap; flex:1; }
  .pi { text-align:center; min-width:86px; }
  .pi .n { font-size:22px; font-weight:800; color:#3d4a33; }
  .pi .l { font-size:10.5px; font-weight:600; color:#8a5a2b; text-transform:uppercase; letter-spacing:.05em; margin-top:2px; }
  .notes { border:1.5px solid #E3B48F; border-radius:14px; padding:12px 18px; margin-top:12px; background:#fff9f2aa; }
  .notes .t { font-size:11px; font-weight:700; letter-spacing:.12em; color:#D96A3B; text-transform:uppercase; margin-bottom:5px; }
  .notes p { font-size:12.5px; line-height:1.55; white-space:pre-wrap; }
  .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-top:20px; }
  .day { border:1px solid #E5D9C8; border-radius:12px; overflow:hidden; background:#FFFDF9; break-inside:avoid; }
  .day-head { background:#44543A; color:#fff; text-align:center; padding:9px 8px 7px; }
  .day-date { font-weight:700; font-size:13.5px; letter-spacing:.06em; }
  .day-tag { color:#F0B58A; font-size:10px; font-weight:700; letter-spacing:.1em; margin-top:2px; }
  table.meals { width:100%; border-collapse:collapse; }
  .cols th { font-size:10px; color:#8a8474; font-weight:600; padding:6px 4px 2px; text-align:center; }
  .cols th:first-child { text-align:left; padding-left:12px; }
  .meals td { padding:7px 4px; border-top:1px solid #F0E8DA; text-align:center; font-size:13px; }
  td.meal { text-align:left; padding-left:12px; white-space:nowrap; }
  td.meal .ic { margin-right:5px; }
  td.meal b { font-size:10.5px; letter-spacing:.06em; }
  td.meal .tm { display:block; font-size:10px; color:#9a8f7a; margin-left:22px; }
  td.n { font-weight:600; font-variant-numeric:tabular-nums; }
  td.n.total { font-weight:800; font-size:15px; color:#3d4a33; }
  .day-note { font-size:10px; color:#8a8474; padding:7px 12px; border-top:1px solid #F0E8DA; }
  .foot { margin-top:22px; border:1.5px solid #E3B48F; border-radius:14px; padding:12px 18px; display:flex; gap:26px; flex-wrap:wrap; background:#fff9f2aa; }
  .foot .t { font-size:11px; font-weight:700; letter-spacing:.12em; color:#3d4a33; text-transform:uppercase; width:100%; }
  .fk { font-size:11.5px; color:#5d6153; }
  .fk b { color:#31352E; }
  .printed { text-align:center; font-size:10px; color:#9a8f7a; margin-top:18px; }
  @media print {
    body { padding:18px 20px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .grid { gap:10px; }
  }
</style>
</head>
<body>
  <div class="brand">QUINTA <span class="heart">♡</span> DO AMOR</div>
  <h1>Food plan — ${esc(name)}</h1>
  <div class="sub">${esc(fmtRange(booking.check_in_date, booking.check_out_date))} · ${baseGuests} guests</div>

  <div class="panel">
    <div class="t">Guests &amp; diets</div>
    <div class="items">
      <div class="pi"><div class="n">${baseGuests}</div><div class="l">guests</div></div>
      <div class="pi"><div class="n">${veg}</div><div class="l">🌿 vegetarian</div></div>
      <div class="pi"><div class="n">${meatBoth}</div><div class="l">🍖 meat lunch + dinner</div></div>
      <div class="pi"><div class="n">${meatDinner}</div><div class="l">🍖 meat dinner only</div></div>
      <div class="pi"><div class="n">${totalMeals}</div><div class="l">meals total</div></div>
    </div>
  </div>

  ${plan.notes_food?.trim() ? `
  <div class="notes">
    <div class="t">Dietary restrictions &amp; notes</div>
    <p>${esc(plan.notes_food.trim())}</p>
  </div>` : ""}

  <div class="grid">
    ${days.map(dayCard).join("")}
  </div>

  <div class="foot">
    <div class="t">Meal counts key</div>
    <span class="fk"><b>👥</b> total plates to prepare that meal</span>
    <span class="fk"><b>🌿 veg</b> vegetarian portions (all meals)</span>
    <span class="fk"><b>🍖 meat</b> meat portions — lunch: "lunch + dinner" guests only · dinner: both meat groups</span>
  </div>

  <div class="printed">Printed from guest.quintamor.com · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div>

  <script>window.addEventListener('load', () => setTimeout(() => window.print(), 300));</script>
</body>
</html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
