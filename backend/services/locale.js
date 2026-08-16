/**
 * Receptionist language selection for T-11 (and future locales).
 *
 * RECEPTIONIST_LOCALE=en   English (default)
 * RECEPTIONIST_LOCALE=af   Afrikaans (af-ZA)
 */

export const SUPPORTED_LOCALES = ['en', 'af'];

/**
 * @returns {'en' | 'af'}
 */
export function resolveReceptionistLocale() {
  const raw = (process.env.RECEPTIONIST_LOCALE || 'en').trim().toLowerCase();
  if (raw === 'af' || raw === 'af-za' || raw === 'afrikaans') return 'af';
  return 'en';
}

export function localeDisplayName(locale) {
  return locale === 'af' ? 'Afrikaans' : 'English';
}
