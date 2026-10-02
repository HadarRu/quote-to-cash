import { z } from 'zod';

/** Phone number in E.164 format, e.g. +972521234567. */
export const phoneE164Schema = z.string().regex(/^\+[1-9]\d{1,14}$/, 'invalid_e164_phone');
export type PhoneE164 = z.infer<typeof phoneE164Schema>;
