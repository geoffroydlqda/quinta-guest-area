import { jsPDF } from "jspdf";

/**
 * Generates a minimal airport sign PDF: white background, large
 * uppercase black names (one per line), centered on a portrait A4 page.
 * Accepts a single name or an array of names (passenger order preserved).
 */
export function generateAirportSignPdf(
  rawNames: string | string[],
  filename?: string
): boolean {
  try {
    const namesArr = (Array.isArray(rawNames) ? rawNames : [rawNames])
      .map((n) => (n || "").trim().toUpperCase())
      .filter(Boolean);
    if (namesArr.length === 0) return false;

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // White background, black bold sans-serif text
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageWidth, pageHeight, "F");
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");

    // Auto-fit: text must fit width AND total height (with line spacing)
    const maxWidth = pageWidth - 20; // 10mm side margins
    const maxHeight = pageHeight - 40; // leave room for subtitle + margins
    const lineSpacing = 1.25;

    // Start size depends on number of names
    let fontSize = namesArr.length === 1 ? 160 : Math.max(40, Math.floor(220 / namesArr.length));
    doc.setFontSize(fontSize);

    const fits = () => {
      doc.setFontSize(fontSize);
      const widestOK = namesArr.every((n) => doc.getTextWidth(n) <= maxWidth);
      // jsPDF font size is in pt; 1pt ≈ 0.3528mm
      const lineHeightMm = fontSize * 0.3528 * lineSpacing;
      const totalHeight = lineHeightMm * namesArr.length;
      return widestOK && totalHeight <= maxHeight;
    };

    while (!fits() && fontSize > 18) {
      fontSize -= 2;
    }
    doc.setFontSize(fontSize);

    const lineHeightMm = fontSize * 0.3528 * lineSpacing;
    const blockHeight = lineHeightMm * namesArr.length;
    const startY = (pageHeight - blockHeight) / 2 + lineHeightMm / 2;

    namesArr.forEach((n, i) => {
      doc.text(n, pageWidth / 2, startY + i * lineHeightMm, {
        align: "center",
        baseline: "middle",
      });
    });

    // Subtle subtitle at the bottom
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(160, 160, 160);
    doc.text("QUINTA DO AMOR", pageWidth / 2, pageHeight - 12, {
      align: "center",
      baseline: "middle",
    });

    const safeBase = filename || `airport-sign-${namesArr.join("-")}`;
    const safe = safeBase.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80);
    doc.save(`${safe}.pdf`);
    return true;
  } catch (e) {
    if (import.meta.env.DEV) console.error("[airport-sign] generation failed", e);
    return false;
  }
}

export function resolveAirportSignName(opts: {
  contactPerson?: string | null;
  firstPassenger?: string | null;
  guestFullName?: string | null;
}): string {
  const pick = (s?: string | null) => (s || "").trim();
  return pick(opts.contactPerson) || pick(opts.firstPassenger) || pick(opts.guestFullName) || "";
}

/** Resolve the list of names to display on the airport sign for a trip. */
export function resolveAirportSignNames(opts: {
  passengers?: Array<{ first_name?: string | null; last_name?: string | null }> | null;
  guestFullName?: string | null;
}): string[] {
  const list = (opts.passengers || [])
    .map((p) => `${(p.first_name || "").trim()} ${(p.last_name || "").trim()}`.trim())
    .filter(Boolean);
  if (list.length > 0) return list;
  const fallback = (opts.guestFullName || "").trim();
  return fallback ? [fallback] : [];
}
