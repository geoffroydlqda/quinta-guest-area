// Préparation du body_html archivé pour les visionneuses d'email (iframe
// sandboxée de SentEmailsCard et de la fiche booking — 18 nov 2026).
//
// Problème vécu par Geoffroy : cliquer un lien (bouton Pay, "Open my Guest
// Area"…) dans la preview naviguait DANS l'iframe sandboxée, où les scripts
// sont interdits → page "You need to enable JavaScript to run this app.".
//
// Correctif en deux moitiés, indissociables :
//  1. `emailPreviewDoc` injecte <base target="_blank"> dans le HTML : tout
//     lien du mail s'ouvre dans un nouvel onglet au lieu de l'iframe.
//  2. L'iframe doit poser sandbox="allow-popups allow-popups-to-escape-sandbox"
//     (EMAIL_PREVIEW_SANDBOX) : sans allow-popups le nouvel onglet est bloqué,
//     et sans allow-popups-to-escape-sandbox il HÉRITE du sandbox (donc
//     toujours pas de JS — même erreur dans un onglet). Les scripts restent
//     interdits dans la preview elle-même : on n'ajoute PAS allow-scripts.
export const EMAIL_PREVIEW_SANDBOX = "allow-popups allow-popups-to-escape-sandbox";

export function emailPreviewDoc(html: string): string {
  const base = '<base target="_blank">';
  // <base> doit vivre dans <head> : on l'insère au bon endroit si la
  // structure existe, sinon en tête (le parser créera le head autour).
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + base);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + base);
  return base + html;
}
