export const normalizeEmail = (email?: string | null) => email?.normalize('NFC').toLowerCase().trim() ?? '';

// ⚠️ Source de vérité serveur = table public.admin_users (RLS + Edge Functions).
// Cette liste front est purement cosmétique (redirections, badges) : pour
// ajouter un admin -> INSERT dans admin_users PUIS mettre à jour cette liste.
export const ADMIN_EMAILS = [
  'hello@quintamor.com',
  'loïs@quintamor.com',
  'lois@quintamor.com',
  '977luisferreira@gmail.com',
  'thomasquerton@gmail.com',
].map(normalizeEmail);

export function isAdminEmail(email?: string | null): boolean {
  return ADMIN_EMAILS.includes(normalizeEmail(email));
}
