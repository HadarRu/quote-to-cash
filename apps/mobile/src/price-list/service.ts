import {
  getStarterPriceList,
  priceMinorSchema,
  ServiceCategorySchema,
  ServiceSchema,
  type BusinessTrade,
  type ServiceCategoryInput,
  type ServiceInput,
  type StarterPriceList,
} from '@q2c/types';
import type { ErrorKey } from '@q2c/ui';
import { parseMoneyInput } from '@q2c/utils';
import { dbErrorKey, type DbError, type DbResult } from '../lib/db';
import type { PriceList } from './model';

export interface ServiceRowWrite {
  id: string;
  business_id: string;
  category_id: string | null;
  name: string;
  unit: string;
  default_price_minor: number;
  vat_included: boolean;
  is_favorite: boolean;
}

export interface CategoryRowWrite {
  id: string;
  business_id: string;
  name: string;
}

/** Price list data access (Supabase Data API under RLS; see db.ts). */
export interface PriceListDb {
  load(businessId: string): Promise<DbResult<PriceList>>;
  upsertService(row: ServiceRowWrite): Promise<{ error: DbError | null }>;
  updateService(
    id: string,
    patch: { default_price_minor?: number; is_favorite?: boolean },
  ): Promise<{ error: DbError | null }>;
  softDeleteService(id: string): Promise<{ error: DbError | null }>;
  upsertCategory(row: CategoryRowWrite): Promise<{ error: DbError | null }>;
  softDeleteCategory(id: string): Promise<{ error: DbError | null }>;
  importStarter(businessId: string, list: StarterPriceList): Promise<DbResult<number>>;
}

export type FieldErrors<F extends string> = Partial<Record<F, ErrorKey>>;
export type WriteResult = { ok: true } | { ok: false; error: ErrorKey };

/** "-50" is a negative price rather than unreadable text. */
const isNegative = (priceText: string) => /^\s*-\s*\d/.test(priceText);

const done = ({ error }: { error: DbError | null }): WriteResult =>
  error ? { ok: false, error: dbErrorKey(error) } : { ok: true };

/** Validates with the shared ServiceSchema, then inserts or updates the service. */
export async function saveService(
  db: PriceListDb,
  businessId: string,
  values: Omit<ServiceInput, 'priceMinor'> & { priceText: string },
): Promise<WriteResult | { ok: false; fieldErrors: FieldErrors<keyof ServiceInput> }> {
  const priceMinor = parseMoneyInput(values.priceText);
  const parsed = ServiceSchema.safeParse({
    ...values,
    priceMinor: priceMinor ?? (isNegative(values.priceText) ? -1 : Number.NaN),
  });
  if (!parsed.success) {
    const fieldErrors: FieldErrors<keyof ServiceInput> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as keyof ServiceInput;
      fieldErrors[field] ??= (
        field === 'priceMinor' && priceMinor === null && !isNegative(values.priceText)
          ? 'price_invalid'
          : issue.message
      ) as ErrorKey;
    }
    return { ok: false, fieldErrors };
  }
  const s = parsed.data;
  return done(
    await db.upsertService({
      id: s.id,
      business_id: businessId,
      category_id: s.categoryId,
      name: s.name,
      unit: s.unit,
      default_price_minor: s.priceMinor,
      vat_included: s.vatIncluded,
      is_favorite: s.isFavorite,
    }),
  );
}

/** Quick price edit: the typed shekel amount becomes the new price. */
export async function changePrice(
  db: PriceListDb,
  serviceId: string,
  priceText: string,
): Promise<WriteResult> {
  if (isNegative(priceText)) return { ok: false, error: 'price_negative' };
  const priceMinor = parseMoneyInput(priceText);
  if (priceMinor === null) return { ok: false, error: 'price_invalid' };
  const parsed = priceMinorSchema.safeParse(priceMinor);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message as ErrorKey };
  return done(await db.updateService(serviceId, { default_price_minor: parsed.data }));
}

export async function setFavorite(
  db: PriceListDb,
  serviceId: string,
  isFavorite: boolean,
): Promise<WriteResult> {
  return done(await db.updateService(serviceId, { is_favorite: isFavorite }));
}

/** Soft delete: quotes keep their own copy of the line (quote_item), so they are unaffected. */
export async function deleteService(db: PriceListDb, serviceId: string): Promise<WriteResult> {
  return done(await db.softDeleteService(serviceId));
}

export async function saveCategory(
  db: PriceListDb,
  businessId: string,
  values: ServiceCategoryInput,
): Promise<WriteResult> {
  const parsed = ServiceCategorySchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message as ErrorKey };
  return done(
    await db.upsertCategory({
      id: parsed.data.id,
      business_id: businessId,
      name: parsed.data.name,
    }),
  );
}

/** Its services stay and show under "no category". */
export async function deleteCategory(db: PriceListDb, categoryId: string): Promise<WriteResult> {
  return done(await db.softDeleteCategory(categoryId));
}

/** Imports the starter list for the business's trade; safe to repeat (returns how many were added). */
export async function importStarterPriceList(
  db: PriceListDb,
  businessId: string,
  trade: BusinessTrade | null,
): Promise<{ ok: true; added: number } | { ok: false; error: ErrorKey }> {
  const list = getStarterPriceList(trade);
  if (!list) return { ok: false, error: 'no_starter_list' };
  const result = await db.importStarter(businessId, list);
  return result.error
    ? { ok: false, error: dbErrorKey(result.error) }
    : { ok: true, added: result.data };
}
