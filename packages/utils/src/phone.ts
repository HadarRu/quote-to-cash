import { phoneE164Schema, type PhoneE164 } from '@q2c/types';

const IL_COUNTRY_CODE = '972';
/** Israeli national number without trunk 0: landlines 8 digits, mobile (05x) and VoIP (07x) 9 digits. */
const IL_NATIONAL_NUMBER = /^(?:[23489]\d{7}|[57]\d{8})$/;

/**
 * Normalizes an Israeli phone number typed in any common form
 * ("052-123-4567", "+972 52 123 4567", "00972521234567") to E.164.
 * Returns null when the input is not a valid Israeli number.
 */
export function toE164IL(input: string): PhoneE164 | null {
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
  return phoneE164Schema.parse(`+${IL_COUNTRY_CODE}${digits}`);
}

export function isE164(value: string): value is PhoneE164 {
  return phoneE164Schema.safeParse(value).success;
}
