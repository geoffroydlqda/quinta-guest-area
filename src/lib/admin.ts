const normalize = (e: string) => e.normalize('NFC').toLowerCase().trim();

export const ADMIN_EMAILS = [
  'hello@quintamor.com',
  'loïs@quintamor.com',
].map(normalize);

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(normalize(email));
}
