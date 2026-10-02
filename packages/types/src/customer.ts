import { z } from 'zod';
import { emailSchema } from './contact.ts';
import { PhoneSchema } from './phone.ts';

/** Empty text inputs mean "not provided". */
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => (value === '' ? undefined : value))
    .optional();

export const CUSTOMER_NAME_MIN = 2;
export const CUSTOMER_NAME_MAX = 200;

export const customerNameSchema = z
  .string()
  .trim()
  .min(CUSTOMER_NAME_MIN, 'customer_name_too_short')
  .max(CUSTOMER_NAME_MAX, 'customer_name_too_long');

/** Optional address on the customer form (stored as the primary customer_address). */
export const CustomerAddressSchema = z.object({
  street: z.string().trim().min(1, 'address_street_required').max(200, 'address_too_long'),
  houseNumber: optionalText(20, 'address_too_long'),
  apartment: optionalText(20, 'address_too_long'),
  city: z.string().trim().min(1, 'address_city_required').max(100, 'address_too_long'),
  postalCode: z
    .string()
    .trim()
    .transform((value) => value.replace(/\D/g, ''))
    .pipe(z.union([z.literal(''), z.string().regex(/^\d{7}$/, 'postal_code_invalid')]))
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
  accessNotes: optionalText(1000, 'address_too_long'),
});
export type CustomerAddressInput = z.infer<typeof CustomerAddressSchema>;

/** Add / Edit Customer. Name and phone are required; everything else is optional. */
export const CustomerSchema = z.object({
  /** Client-generated, so a retried save never creates a duplicate. */
  id: z.uuid('customer_id_invalid'),
  fullName: customerNameSchema,
  phone: PhoneSchema,
  email: z
    .union([z.literal(''), emailSchema])
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
  notes: optionalText(4000, 'notes_too_long'),
  address: CustomerAddressSchema.optional(),
});
export type CustomerInput = z.infer<typeof CustomerSchema>;

/** Quick-create (e.g. from the quote flow): name and phone only. */
export const QuickCustomerSchema = CustomerSchema.pick({ id: true, fullName: true, phone: true });
export type QuickCustomerInput = z.infer<typeof QuickCustomerSchema>;
