import validator from 'validator';

/**
 * Accepts common mobile formats; set locale via PHONE_LOCALE env (e.g. en-PK) or use 'any'.
 */
export function isValidPhone(phone) {
  if (typeof phone !== 'string') return false;
  const s = phone.trim();
  if (!s) return false;
  const locale = process.env.PHONE_LOCALE || 'any';
  return validator.isMobilePhone(s, locale);
}
