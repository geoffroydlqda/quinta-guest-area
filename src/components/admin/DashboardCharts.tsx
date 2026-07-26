import { useMemo, useState } from "react";

/**
 * Graphiques du dashboard admin — SVG maison, sans dépendance.
 * Palette validée (scripts/validate_palette.js du skill dataviz, mode light,
 * surface #f0e7e1) : ramp ordinal une teinte — collected #5e6d3f (foncé),
 * outstanding #899b53 (clair, 2.50:1 vs surface → labels de cap en relief).
 */
const C_COLLECTED = "#5e6d3f";
const C_OUTSTANDING = "#899b53";
const C_GRID = "#ddd4cc";
const C_TEXT_MUTED = "#5a5a55";

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
  /** 12 entrées, index 0 = janvier ; montants TVAC. */
  months: { collected: number; outstanding: number }[];
}) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const W = 720, H = 240, mL = 46, mR = 8, mT = 16, mB = 24;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const max = niceMax(Math.max(...months.map((m) => m.collected + m.outstanding), 1));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const slot = plotW / 12;
  const barW = Math.min(24, slot * 0.55);
  const y = (v: number) => mT + plotH - (v / max) * plotH;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Monthly revenue, collected vs outstanding">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={mL} x2={W - mR} y1={y(t)} y2={y(t)} stroke={C_GRID} strokeWidth="1" />
            <text x={mL - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill={C_TEXT_MUTED}>
              {compact(t)}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const total = m.collected + m.outstanding;
          const x = mL + i * slot + (slot - barW) / 2;
          const hCol = (m.collected / max) * plotH;
          const hOut = (m.outstanding / max) * plotH;
          const gap = hCol > 0 && hOut > 0 ? 2 : 0;
          const yCol = mT + plotH - hCol;
          const yOut = yCol - gap - hOut;
          const isHover = hover === i;
          const show = () => {
            setHover(i);
            setTip({
              leftPct: ((x + barW / 2) / W) * 100,
              topPct: ((Math.min(yOut, yCol) - 6) / H) * 100,
              title: MONTHS[i],
              rows: [
                { label: "collected", value: fmtEUR0(m.collected), color: C_COLLECTED },
                { label: "outstanding", value: fmtEUR0(m.outstanding), color: C_OUTSTANDING },
                { label: "total", value: fmtEUR0(total) },
              ],
            });
          };
          const hide = () => { setHover(null); setTip(null); };
          return (
            <g key={i} opacity={hover !== null && !isHover ? 0.75 : 1}>
              {/* segment collected (base) — arrondi seulement s'il est au sommet */}
              {hCol > 0 && (hOut > 0
                ? <rect x={x} y={yCol} width={barW} height={hCol} fill={C_COLLECTED} />
                : <path d={roundedTopRect(x, yCol, barW, hCol, 4)} fill={C_COLLECTED} />)}
              {hOut > 0 && <path d={roundedTopRect(x, yOut, barW, hOut, 4)} fill={C_OUTSTANDING} />}
              {total > 0 && (
                <text x={x + barW / 2} y={Math.min(yOut, yCol) - 4} textAnchor="middle" fontSize="9.5" fill={C_TEXT_MUTED}>
                  {compact(total)}
                </text>
              )}
              <text x={mL + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize="10" fill={C_TEXT_MUTED}>
                {MONTHS[i]}
              </text>
              {/* zone de hit plus large que la marque */}
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
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-[2px]" style={{ background: C_COLLECTED }} /> Collected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-[2px]" style={{ background: C_OUTSTANDING }} /> Outstanding
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Occupancy
export function OccupancyChart({
  months,
}: {
  /** 12 entrées : nuits occupées + nombre de jours du mois. */
  months: { nights: number; days: number }[];
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
          const show = () => {
            setHover(i);
            setTip({
              leftPct: ((x + barW / 2) / W) * 100,
              topPct: ((y(pct) - 6) / H) * 100,
              title: MONTHS[i],
              rows: [
                { label: "occupancy", value: `${Math.round(pct)}%`, color: C_COLLECTED },
                { label: `of ${m.days} nights`, value: String(m.nights) },
              ],
            });
          };
          const hide = () => { setHover(null); setTip(null); };
          return (
            <g key={i} opacity={hover !== null && !isHover ? 0.75 : 1}>
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
