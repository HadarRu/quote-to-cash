/** E.164: '+', country code, up to 15 digits in total. */
export const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

const IL_COUNTRY_CODE = '972';
/** Israeli national number without trunk 0: landlines 8 digits, mobile (05x) and VoIP (07x) 9 digits. */
const IL_NATIONAL_NUMBER = /^(?:[23489]\d{7}|[57]\d{8})$/;

/**
 * Normalizes an Israeli phone number typed in any common form
 * ("052-123-4567", "+972 52 123 4567", "00972521234567") to E.164.
 * Returns null when the input is not a valid Israeli number.
 */
export function toE164IL(input: string): string | null {
  let digits = input.trim().replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(digits)) return null;

  if (digits.startsWith('+')) {
    if (!digits.startsWith(`+${IL_COUNTRY_CODE}`)) return null;
    digits = digits.slice(1 + IL_COUNTRY_CODE.length);
  } else if (digits.startsWith(`00${IL_COUNTRY_CODE}`)) {
    digits = digits.slice(2 + IL_COUNTRY_CODE.length);
  } else if (digits.startsWith(IL_COUNTRY_CODE) && digits.length > 10) {
    digits = digits.slice(IL_COUNTRY_CODE.length);
  }
  // Drop the domestic trunk prefix ("052..." and the common "+972 052..." mistake).
  if (digits.startsWith('0')) digits = digits.slice(1);

  if (!IL_NATIONAL_NUMBER.test(digits)) return null;
  return `+${IL_COUNTRY_CODE}${digits}`;
}

export function isE164(value: string): boolean {
  return E164_PATTERN.test(value);
}

/**
 * Formats an Israeli E.164 number for display: +972521234567 -> 052-123-4567,
 * +97231234567 -> 03-123-4567. Other numbers are returned unchanged.
 */
export function formatPhoneIL(e164: string): string {
  const prefix = `+${IL_COUNTRY_CODE}`;
  if (!e164.startsWith(prefix)) return e164;
  const national = `0${e164.slice(prefix.length)}`;
  if (national.length === 10)
    return `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`;
  if (national.length === 9)
    return `${national.slice(0, 2)}-${national.slice(2, 5)}-${national.slice(5)}`;
  return e164;
}

/** `tel:` link for the dialer. */
export function telUrl(e164: string): string {
  return `tel:${e164}`;
}

/** WhatsApp click-to-chat link (wa.me expects digits only, no '+'). */
export function whatsappUrl(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, '')}`;
}

/**
 * True when the digits the user typed appear in the number, in either its
 * international (972...) or Israeli national (05...) form. "052-12", "+97252"
 * and "52123" all match +972521234567.
 */
export function phoneMatches(e164: string, typed: string): boolean {
  const query = typed.replace(/\D/g, '');
  if (!query) return false;
  const international = e164.replace(/\D/g, '');
  const prefix = IL_COUNTRY_CODE;
  const national = international.startsWith(prefix)
    ? `0${international.slice(prefix.length)}`
    : international;
  return international.includes(query) || national.includes(query);
}
