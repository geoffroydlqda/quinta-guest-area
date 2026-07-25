import { jsPDF } from 'jspdf';

/**
 * Génère un PDF A4 paysage du plan des chambres avec, sous chaque pastille,
 * les guests assignés. Utilisé par la page Room Setup (guest et admin via
 * impersonation) — pensé pour être téléchargé/imprimé pour le check-in.
 */
export interface RoomMapEntry {
  roomId: number;
  guests: string[];
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

export async function downloadRoomMapPdf(
  imageSrc: string,
  entries: RoomMapEntry[],
  opts?: { title?: string; subtitle?: string },
): Promise<void> {
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

  for (const entry of entries) {
    const pin = PINS[entry.roomId];
    if (!pin || entry.guests.length === 0) continue;
    const label = entry.guests.join(' & ');
    const x = (pin.x / 100) * W;
    // Étiquette sous la pastille (les numéros sont déjà dessinés sur l'image)
    const y = (pin.y / 100) * H + H * 0.045;

    ctx.font = `600 ${fontPx}px Helvetica, Arial, sans-serif`;
    const textW = ctx.measureText(label).width;
    const padX = fontPx * 0.6;
    const boxW = textW + padX * 2;
    const boxH = fontPx * 1.7;
    const r = boxH / 2;

    // Fond arrondi
    ctx.beginPath();
    ctx.moveTo(x - boxW / 2 + r, y - boxH / 2);
    ctx.arcTo(x + boxW / 2, y - boxH / 2, x + boxW / 2, y + boxH / 2, r);
    ctx.arcTo(x + boxW / 2, y + boxH / 2, x - boxW / 2, y + boxH / 2, r);
    ctx.arcTo(x - boxW / 2, y + boxH / 2, x - boxW / 2, y - boxH / 2, r);
    ctx.arcTo(x - boxW / 2, y - boxH / 2, x + boxW / 2, y - boxH / 2, r);
    ctx.closePath();
    ctx.fillStyle = GREEN;
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x, y + fontPx * 0.05);
  }

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
