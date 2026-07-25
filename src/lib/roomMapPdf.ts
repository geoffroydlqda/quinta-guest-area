import { jsPDF } from 'jspdf';

/**
 * Génère un PDF A4 paysage du plan des chambres avec, sous chaque pastille,
 * les guests assignés. Utilisé par la page Room Setup (guest et admin via
 * impersonation) — pensé pour être téléchargé/imprimé pour le check-in.
 */
export interface RoomMapEntry {
  roomId: number;
  guests: string[];
  /** 'king' | 'twin' — affiché sous les noms pour un check d'un coup d'œil */
  bedType?: 'king' | 'twin';
}

// Position des pastilles en pourcentage de l'image (mêmes valeurs que RoomSetup)
const PINS: Record<number, { x: number; y: number }> = {
  1: { x: 18.4, y: 39.6 },
  2: { x: 18.4, y: 54.5 },
  3: { x: 18.4, y: 67.9 },
  4: { x: 18.4, y: 83.6 },
  5: { x: 29.2, y: 83.6 },
  6: { x: 46.1, y: 83.6 },
  7: { x: 24.4, y: 5.0 },
  8: { x: 24.4, y: 24.3 },
  9: { x: 60.4, y: 9.3 },
  10: { x: 71.5, y: 9.3 },
  11: { x: 83.5, y: 9.3 },
};

const GREEN = '#4a5a3a';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Rendu du plan annoté (noms + type de lit) — utilisé en direct ET pour le PDF. */
export async function renderRoomMapCanvas(
  imageSrc: string,
  entries: RoomMapEntry[],
): Promise<HTMLCanvasElement> {
  const img = await loadImage(imageSrc);
  const W = img.naturalWidth;
  const H = img.naturalHeight;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);

  const fontPx = Math.round(W * 0.016);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${fontPx}px Helvetica, Arial, sans-serif`;

  // 1) Préparer toutes les étiquettes : noms (un par ligne) + type de lit
  interface LabelBox { x: number; y: number; w: number; h: number; lines: string[]; bedLine: string | null }
  const bedFontPx = Math.round(fontPx * 0.78);
  const lineH = fontPx * 1.45;
  const bedLineH = bedFontPx * 1.5;
  const padX = fontPx * 0.6;
  const padY = fontPx * 0.35;
  const boxes: LabelBox[] = [];
  for (const entry of entries) {
    const pin = PINS[entry.roomId];
    if (!pin) continue;
    const bedLine = entry.bedType ? (entry.bedType === 'twin' ? 'Twin beds' : 'King bed') : null;
    const lines = entry.guests;
    if (lines.length === 0 && !bedLine) continue;
    ctx.font = `600 ${fontPx}px Helvetica, Arial, sans-serif`;
    const namesW = lines.length ? Math.max(...lines.map((l) => ctx.measureText(l).width)) : 0;
    ctx.font = `italic ${bedFontPx}px Helvetica, Arial, sans-serif`;
    const bedW = bedLine ? ctx.measureText(bedLine).width : 0;
    const w = Math.max(namesW, bedW) + padX * 2;
    const h = lines.length * lineH + (bedLine ? bedLineH : 0) + padY * 2;
    boxes.push({
      x: (pin.x / 100) * W,
      y: (pin.y / 100) * H + H * 0.045 + h / 2,
      w,
      h,
      lines,
      bedLine,
    });
  }

  // 2) Résolution de collisions : si deux étiquettes se chevauchent,
  //    décaler la seconde vers le bas jusqu'à libération
  const overlaps = (a: LabelBox, b: LabelBox) =>
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 + fontPx * 0.4 &&
    Math.abs(a.y - b.y) < (a.h + b.h) / 2 + fontPx * 0.3;
  const placed: LabelBox[] = [];
  for (const box of boxes.sort((a, b) => a.y - b.y || a.x - b.x)) {
    let guard = 0;
    while (placed.some((p) => overlaps(p, box)) && guard < 20) {
      box.y += lineH * 0.9;
      guard++;
    }
    placed.push(box);
  }

  // 3) Dessin
  for (const box of placed) {
    const { x, y, w, h, lines } = box;
    const r = Math.min(h / 2, fontPx * 0.9);
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + r, y - h / 2);
    ctx.arcTo(x + w / 2, y - h / 2, x + w / 2, y + h / 2, r);
    ctx.arcTo(x + w / 2, y + h / 2, x - w / 2, y + h / 2, r);
    ctx.arcTo(x - w / 2, y + h / 2, x - w / 2, y - h / 2, r);
    ctx.arcTo(x - w / 2, y - h / 2, x + w / 2, y - h / 2, r);
    ctx.closePath();
    ctx.fillStyle = GREEN;
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${fontPx}px Helvetica, Arial, sans-serif`;
    lines.forEach((line, i) => {
      const ly = y - h / 2 + padY + lineH * (i + 0.5);
      ctx.fillText(line, x, ly + fontPx * 0.05);
    });
    if (box.bedLine) {
      ctx.font = `italic ${bedFontPx}px Helvetica, Arial, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      const by = y - h / 2 + padY + lines.length * lineH + bedLineH * 0.5;
      ctx.fillText(box.bedLine, x, by + bedFontPx * 0.05);
    }
  }

  return canvas;
}

export async function downloadRoomMapPdf(
  imageSrc: string,
  entries: RoomMapEntry[],
  opts?: { title?: string; subtitle?: string },
): Promise<void> {
  const canvas = await renderRoomMapCanvas(imageSrc, entries);
  const W = canvas.width;
  const H = canvas.height;

  // PDF A4 paysage : titre + plan
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = 297;
  const pageH = 210;
  const margin = 10;
  const headerH = 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(74, 90, 58);
  doc.text(opts?.title ?? 'Quinta do Amor — Room map', margin, margin + 6);
  if (opts?.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(90, 90, 90);
    doc.text(opts.subtitle, margin, margin + 12);
  }

  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2 - headerH;
  const scale = Math.min(availW / W, availH / H);
  const drawW = W * scale;
  const drawH = H * scale;
  const dx = (pageW - drawW) / 2;
  const dy = margin + headerH + (availH - drawH) / 2;

  doc.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', dx, dy, drawW, drawH);
  doc.save('quinta-do-amor-room-map.pdf');
}
