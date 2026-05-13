import { jsPDF } from "jspdf";

/**
 * Generates a minimal airport sign PDF: white background, very large
 * uppercase black name, centered on a portrait A4 page.
 */
export function generateAirportSignPdf(rawName: string, filename?: string): boolean {
  try {
    const name = (rawName || "").trim().toUpperCase();
    if (!name) return false;

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // White background, black bold sans-serif text
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageWidth, pageHeight, "F");
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");

    // Auto-fit text to width (portrait → narrower, start a bit smaller)
    const maxWidth = pageWidth - 20; // 10mm side margins
    let fontSize = 160;
    doc.setFontSize(fontSize);
    while (doc.getTextWidth(name) > maxWidth && fontSize > 24) {
      fontSize -= 4;
      doc.setFontSize(fontSize);
    }

    doc.text(name, pageWidth / 2, pageHeight / 2, {
      align: "center",
      baseline: "middle",
    });

    const safe = (filename || `airport-sign-${name}`)
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .slice(0, 80);
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
