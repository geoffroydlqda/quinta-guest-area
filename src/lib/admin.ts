export const normalizeEmail = (email?: string | null) => email?.normalize('NFC').toLowerCase().trim() ?? '';

export const ADMIN_EMAILS = [
  'hello@quintamor.com',
  'loïs@quintamor.com',
  'lois@quintamor.com',
  '977luisferreira@gmail.com',
].map(normalizeEmail);

export function isAdminEmail(email?: string | null): boolean {
  return ADMIN_EMAILS.includes(normalizeEmail(email));
}
