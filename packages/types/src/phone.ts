import { E164_PATTERN, toE164IL } from '@q2c/utils';
import { z } from 'zod';

/** Phone number already in E.164 format, e.g. +972521234567 (as stored in the database). */
export const phoneE164Schema = z.string().regex(E164_PATTERN, 'phone_invalid');
export type PhoneE164 = z.infer<typeof phoneE164Schema>;

/**
 * Israeli phone number as typed by a user ("052-123-4567", "+972 52 123 4567", ...),
 * validated and normalized to E.164. Output is a PhoneE164.
 */
export const PhoneSchema = z.string().transform((value, ctx): PhoneE164 => {
  const e164 = toE164IL(value);
  if (e164 === null) {
    ctx.issues.push({ code: 'custom', message: 'phone_invalid', input: value });
    return z.NEVER;
  }
  return e164;
});
