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

// CENTRE de chaque chambre en pourcentage de l'image : la carte (badge numéro
// + noms + type de lit) est posée SUR la chambre, en un seul bloc — avant, les
// noms flottaient sous la pastille imprimée du plan et l'anti-chevauchement
// pouvait les éloigner de leur chambre (illisible, demande Geoffroy 5 sept 2026).
const CARD_ANCHORS: Record<number, { x: number; y: number }> = {
  1: { x: 16.5, y: 41.0 },
  2: { x: 15.5, y: 55.0 },
  3: { x: 14.5, y: 71.5 },
  4: { x: 14.0, y: 86.0 },
  5: { x: 31.5, y: 86.5 },
  6: { x: 48.0, y: 85.0 },
  7: { x: 21.5, y: 8.8 },
  8: { x: 21.5, y: 23.5 },
  9: { x: 59.5, y: 16.5 },
  10: { x: 71.0, y: 16.5 },
  11: { x: 82.5, y: 16.5 },
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

  // 1) Préparer les cartes : badge numéro (sur le bord haut) + noms + type de
  //    lit, un seul bloc centré sur la chambre.
  interface LabelBox { roomId: number; x: number; y: number; w: number; h: number; lines: string[]; bedLine: string | null }
  const bedFontPx = Math.round(fontPx * 0.78);
  const lineH = fontPx * 1.45;
  const bedLineH = bedFontPx * 1.5;
  const padX = fontPx * 0.6;
  const padY = fontPx * 0.35;
  const badgeR = fontPx * 0.95; // rayon du badge numéro, à cheval sur le bord haut
  const topPad = padY + badgeR * 0.8; // les noms commencent sous la partie du badge qui déborde dans la carte
  const boxes: LabelBox[] = [];
  for (const entry of entries) {
    const pin = CARD_ANCHORS[entry.roomId];
    if (!pin) continue;
    const bedLine = entry.bedType ? (entry.bedType === 'twin' ? 'Twin beds' : 'King bed') : null;
    const lines = entry.guests;
    if (lines.length === 0 && !bedLine) continue;
    ctx.font = `600 ${fontPx}px Helvetica, Arial, sans-serif`;
    const namesW = lines.length ? Math.max(...lines.map((l) => ctx.measureText(l).width)) : 0;
    ctx.font = `italic ${bedFontPx}px Helvetica, Arial, sans-serif`;
    const bedW = bedLine ? ctx.measureText(bedLine).width : 0;
    const w = Math.max(namesW, bedW, badgeR * 2.4) + padX * 2;
    const h = topPad + lines.length * lineH + (bedLine ? bedLineH : 0) + padY;
    boxes.push({
      roomId: entry.roomId,
      x: (pin.x / 100) * W,
      y: (pin.y / 100) * H,
      w,
      h,
      lines,
      bedLine,
    });
  }

  // 2) Résolution de collisions (chambres voisines 9/10/11…) : léger décalage
  //    vertical de la seconde carte — les ancres étant au centre des chambres,
  //    ça reste sur la bonne chambre.
  const overlaps = (a: LabelBox, b: LabelBox) =>
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 + fontPx * 0.4 &&
    Math.abs(a.y - b.y) < (a.h + b.h) / 2 + badgeR + fontPx * 0.3;
  const placed: LabelBox[] = [];
  for (const box of boxes.sort((a, b) => a.y - b.y || a.x - b.x)) {
    let guard = 0;
    while (placed.some((p) => overlaps(p, box)) && guard < 20) {
      box.y += lineH * 0.9;
      guard++;
    }
    placed.push(box);
  }

  // 3) Dessin : carte + badge numéro à cheval sur le bord haut
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

    // Badge numéro : cercle vert cerclé de blanc, posé sur le bord haut de la
    // carte — le numéro et les noms ne peuvent plus être dissociés.
    ctx.beginPath();
    ctx.arc(x, y - h / 2, badgeR, 0, Math.PI * 2);
    ctx.fillStyle = GREEN;
    ctx.fill();
    ctx.lineWidth = Math.max(2, fontPx * 0.14);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(fontPx * 0.95)}px Helvetica, Arial, sans-serif`;
    ctx.fillText(String(box.roomId), x, y - h / 2 + fontPx * 0.06);

    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${fontPx}px Helvetica, Arial, sans-serif`;
    lines.forEach((line, i) => {
      const ly = y - h / 2 + topPad + lineH * (i + 0.5);
      ctx.fillText(line, x, ly + fontPx * 0.05);
    });
    if (box.bedLine) {
      ctx.font = `italic ${bedFontPx}px Helvetica, Arial, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      const by = y - h / 2 + topPad + lines.length * lineH + bedLineH * 0.5;
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
