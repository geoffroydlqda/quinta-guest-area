import { useMemo, useState } from "react";

/**
 * Graphiques du dashboard admin — SVG maison, sans dépendance.
 * Palette "light & vibrant" fournie par Geoffroy (31 juil. 2026), validée
 * scripts/validate_palette.js (mode light, surface #ffffff) :
 * - catégorielle 3 slots : rental #79B84B, catering #6EA6FF, extras #EF9455
 *   (variante chart de l'apricot #F2A06B, assombrie d'un cran pour rester
 *   dans la bande de luminance) — CVD + normal-vision PASS ; le contraste
 *   <3:1 est couvert par la règle relief (légendes + tooltips + labels).
 * - occupation : #79B84B (mono-série).
 */
const C_RENTAL = "#8FC46A";
const C_CATERING = "#6EA6FF";
const C_EXTRA = "#EF9455";
const C_COLLECTED = "#8FC46A";
const C_GRID = "#E7E8E1";
const C_TEXT_MUTED = "#6E746B";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const compact = (v: number) =>
  v >= 1000 ? `${(v / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })}K` : String(Math.round(v));

const fmtEUR0 = (v: number) =>
  `€${v.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

/** Coin supérieur arrondi (4px), base carrée — spec marks du skill. */
function roundedTopRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (m * mag >= v) return m * mag;
  }
  return 10 * mag;
}

interface TooltipState {
  leftPct: number;
  topPct: number;
  title: string;
  rows: { label: string; value: string; color?: string }[];
}

function ChartTooltip({ t }: { t: TooltipState }) {
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md"
      style={{
        left: `${t.leftPct}%`,
        top: `${t.topPct}%`,
        transform: `translate(${t.leftPct > 60 ? "-100%" : "0"}, -100%)`,
      }}
    >
      <div className="text-muted-foreground mb-0.5">{t.title}</div>
      {t.rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {r.color && <span className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ background: r.color }} />}
          <span className="font-semibold">{r.value}</span>
          <span className="text-muted-foreground">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Revenue
export function MonthlyRevenueChart({
  months,
}: {
  /** 12 entrées, index 0 = janvier ; montants TVAC par catégorie. */
  months: { rental: number; catering: number; extra: number; collected: number }[];
}) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const W = 720, H = 240, mL = 46, mR = 8, mT = 16, mB = 24;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const totalOf = (m: { rental: number; catering: number; extra: number }) => m.rental + m.catering + m.extra;
  const max = niceMax(Math.max(...months.map(totalOf), 1));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const slot = plotW / 12;
  const barW = Math.min(24, slot * 0.55);

  const SERIES = [
    { key: "rental" as const, label: "Rental", color: C_RENTAL },
    { key: "catering" as const, label: "Catering", color: C_CATERING },
    { key: "extra" as const, label: "Extras", color: C_EXTRA },
  ];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Monthly revenue by category (rental, catering, extras)">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={mL} x2={W - mR} y1={mT + plotH - (t / max) * plotH} y2={mT + plotH - (t / max) * plotH} stroke={C_GRID} strokeWidth="1" />
            <text x={mL - 6} y={mT + plotH - (t / max) * plotH + 3} textAnchor="end" fontSize="10" fill={C_TEXT_MUTED}>
              {compact(t)}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const total = totalOf(m);
          const x = mL + i * slot + (slot - barW) / 2;
          // Empilement bas -> haut : rental, catering, extra ; gaps de 2px ;
          // seul le segment sommital est arrondi (base carrée partout).
          const segs = SERIES
            .map((s) => ({ ...s, value: m[s.key], h: (m[s.key] / max) * plotH }))
            .filter((s) => s.h > 0);
          let cursor = mT + plotH;
          const drawn = segs.map((s, idx) => {
            const yTop = cursor - s.h;
            cursor = yTop - 2; // gap surface entre segments
            return { ...s, yTop, isTop: idx === segs.length - 1 };
          });
          const yTopmost = drawn.length ? drawn[drawn.length - 1].yTop : mT + plotH;
          const isHover = hover === i;
          const show = () => {
            setHover(i);
            setTip({
              leftPct: ((x + barW / 2) / W) * 100,
              topPct: ((yTopmost - 6) / H) * 100,
              title: MONTHS[i],
              rows: [
                ...SERIES.map((s) => ({ label: s.label.toLowerCase(), value: fmtEUR0(m[s.key]), color: s.color })),
                { label: "total", value: fmtEUR0(total) },
                { label: "collected", value: fmtEUR0(m.collected) },
              ],
            });
          };
          const hide = () => { setHover(null); setTip(null); };
          return (
            <g key={i} opacity={hover !== null && !isHover ? 0.75 : 1}>
              {drawn.map((s) => s.isTop
                ? <path key={s.key} d={roundedTopRect(x, s.yTop, barW, s.h, 4)} fill={s.color} />
                : <rect key={s.key} x={x} y={s.yTop} width={barW} height={s.h} fill={s.color} />)}
              {total > 0 && (
                <text x={x + barW / 2} y={yTopmost - 4} textAnchor="middle" fontSize="9.5" fill={C_TEXT_MUTED}>
                  {compact(total)}
                </text>
              )}
              <text x={mL + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize="10" fill={C_TEXT_MUTED}>
                {MONTHS[i]}
              </text>
              <rect
                x={mL + i * slot} y={mT} width={slot} height={plotH} fill="transparent"
                tabIndex={total > 0 ? 0 : -1}
                onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide}
              />
            </g>
          );
        })}
      </svg>
      {tip && <ChartTooltip t={tip} />}
      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-[2px]" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Occupancy
export function OccupancyChart({
  months,
  inSeason,
}: {
  /** 12 entrées : nuits occupées + nombre de jours du mois. */
  months: { nights: number; days: number }[];
  /** Mois dans la saison d'exploitation — les autres sont estompés. */
  inSeason?: boolean[];
}) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const W = 720, H = 240, mL = 40, mR = 8, mT = 16, mB = 24;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const slot = plotW / 12;
  const barW = Math.min(24, slot * 0.55);
  const y = (pct: number) => mT + plotH - (pct / 100) * plotH;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Occupancy rate by month">
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={mL} x2={W - mR} y1={y(t)} y2={y(t)} stroke={C_GRID} strokeWidth="1" />
            <text x={mL - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill={C_TEXT_MUTED}>{t}%</text>
          </g>
        ))}
        {months.map((m, i) => {
          const pct = m.days > 0 ? (m.nights / m.days) * 100 : 0;
          const x = mL + i * slot + (slot - barW) / 2;
          const h = (pct / 100) * plotH;
          const isHover = hover === i;
          const dim = inSeason ? !inSeason[i] : false;
          const baseOpacity = dim ? 0.35 : 1;
          const show = () => {
            setHover(i);
            setTip({
              leftPct: ((x + barW / 2) / W) * 100,
              topPct: ((y(pct) - 6) / H) * 100,
              title: `${MONTHS[i]}${dim ? " (off-season)" : ""}`,
              rows: [
                { label: "occupancy", value: `${Math.round(pct)}%`, color: C_COLLECTED },
                { label: `of ${m.days} nights`, value: String(m.nights) },
              ],
            });
          };
          const hide = () => { setHover(null); setTip(null); };
          return (
            <g key={i} opacity={(hover !== null && !isHover ? 0.75 : 1) * baseOpacity}>
              {h > 0 && <path d={roundedTopRect(x, y(pct), barW, h, 4)} fill={C_COLLECTED} />}
              {pct > 0 && (
                <text x={x + barW / 2} y={y(pct) - 4} textAnchor="middle" fontSize="9.5" fill={C_TEXT_MUTED}>
                  {Math.round(pct)}%
                </text>
              )}
              <text x={mL + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize="10" fill={C_TEXT_MUTED}>
                {MONTHS[i]}
              </text>
              <rect
                x={mL + i * slot} y={mT} width={slot} height={plotH} fill="transparent"
                tabIndex={pct > 0 ? 0 : -1}
                onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide}
              />
            </g>
          );
        })}
      </svg>
      {tip && <ChartTooltip t={tip} />}
    </div>
  );
}
