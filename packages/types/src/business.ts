import { z } from 'zod';
import { Constants } from './database.types.ts';

export const businessTradeSchema = z.enum(Constants.public.Enums.business_trade);
export type BusinessTrade = z.infer<typeof businessTradeSchema>;

export const taxStatusSchema = z.enum(Constants.public.Enums.tax_status);
export type TaxStatus = z.infer<typeof taxStatusSchema>;

export const BUSINESS_NAME_MIN = 2;
export const BUSINESS_NAME_MAX = 80;

/** Business setup form, validated on the client and again by the business-setup Edge Function. */
export const BusinessSetupSchema = z.object({
  /** Client-generated, so a retried request returns the same business. */
  businessId: z.uuid('business_id_invalid'),
  name: z
    .string()
    .trim()
    .min(BUSINESS_NAME_MIN, 'business_name_too_short')
    .max(BUSINESS_NAME_MAX, 'business_name_too_long'),
  trade: businessTradeSchema,
  taxStatus: taxStatusSchema,
});
export type BusinessSetup = z.infer<typeof BusinessSetupSchema>;

/** Limits of the business-assets Storage bucket. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const BusinessLogoSchema = z.object({
  mimeType: z.enum(LOGO_MIME_TYPES, 'logo_type_invalid'),
  sizeBytes: z.number().int().positive().max(LOGO_MAX_BYTES, 'logo_too_large'),
});
export type BusinessLogo = z.infer<typeof BusinessLogoSchema>;
