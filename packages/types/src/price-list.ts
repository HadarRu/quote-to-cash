import { z } from 'zod';
import type { BusinessTrade } from './business.ts';
import electrician from './starter-price-lists/electrician.json' with { type: 'json' };

/** Units are stored as codes and shown in Hebrew by the app (packages/ui i18n). */
export const SERVICE_UNITS = ['unit', 'point', 'meter', 'sqm', 'hour', 'job'] as const;
export const serviceUnitSchema = z.enum(SERVICE_UNITS, 'unit_invalid');
export type ServiceUnit = z.infer<typeof serviceUnitSchema>;

/** Price in agorot: an integer, never negative. */
export const priceMinorSchema = z
  .number('price_invalid')
  .int('price_invalid')
  .min(0, 'price_negative')
  .max(100_000_000, 'price_too_high');

export const serviceNameSchema = z
  .string()
  .trim()
  .min(2, 'service_name_too_short')
  .max(200, 'service_name_too_long');

/** Add / Edit Service. */
export const ServiceSchema = z.object({
  id: z.uuid('service_id_invalid'),
  name: serviceNameSchema,
  categoryId: z.uuid().nullable(),
  unit: serviceUnitSchema,
  priceMinor: priceMinorSchema,
  vatIncluded: z.boolean(),
  isFavorite: z.boolean(),
});
export type ServiceInput = z.infer<typeof ServiceSchema>;

export const ServiceCategorySchema = z.object({
  id: z.uuid('category_id_invalid'),
  name: z.string().trim().min(2, 'category_name_too_short').max(100, 'category_name_too_long'),
});
export type ServiceCategoryInput = z.infer<typeof ServiceCategorySchema>;

const starterKey = z.string().regex(/^[a-z0-9_.-]{1,100}$/);

/** Shape of the JSON files in ./starter-price-lists (also the import RPC's argument). */
export const StarterPriceListSchema = z.object({
  version: z.literal(1),
  trade: z.string(),
  categories: z
    .array(
      z.object({
        key: starterKey,
        name: z.string().min(2).max(100),
        services: z
          .array(
            z.object({
              key: starterKey,
              name: z.string().min(2).max(200),
              unit: serviceUnitSchema,
              price_minor: priceMinorSchema,
              vat_included: z.boolean(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});
export type StarterPriceList = z.infer<typeof StarterPriceListSchema>;

const starterPriceLists: Partial<Record<BusinessTrade, StarterPriceList>> = {
  electrician: StarterPriceListSchema.parse(electrician),
};

/** The starter price list offered to a business of this trade, if there is one. */
export function getStarterPriceList(
  trade: BusinessTrade | null | undefined,
): StarterPriceList | null {
  return (trade && starterPriceLists[trade]) || null;
}
