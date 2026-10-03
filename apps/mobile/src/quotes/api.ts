import type { QuoteStatus, SendQuoteResponse } from '@q2c/types';
import type { DiscountType } from '@q2c/utils';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { isNetworkError } from '../lib/errors';
import type { AppSupabaseClient } from '../lib/supabase';
import type { LocalQuote } from './model';
import type { ApiError, ApiResult, QuotesApi } from './outbox';
import type { LocalPhoto } from './store';

export const QUOTE_PHOTOS_BUCKET = 'quote-photos';

/** Quote photos live under <business>/quotes/<quote>/<photo>.jpg (Storage policies check the business). */
export function quotePhotoPath(businessId: string, quoteId: string, photoId: string): string {
  return `${businessId}/quotes/${quoteId}/${photoId}.jpg`;
}

const QUOTE_COLUMNS = `id, business_id, customer_id, status, quote_number, title, notes, valid_until,
  discount_type, discount_value, revision, supersedes_quote_id, subtotal_minor, discount_minor,
  vat_rate_bp, vat_minor, total_minor, created_at, updated_at, sent_at, viewed_at, approved_at,
  rejected_at, cancelled_at, superseded_at, token_expires_at,
  customer (full_name, phone_e164),
  quote_item (id, service_id, description, quantity, unit, unit_price_minor, vat_included, sort_order, deleted_at)`;

interface QuoteRow {
  id: string;
  business_id: string;
  customer_id: string;
  status: QuoteStatus;
  quote_number: number | null;
  title: string | null;
  notes: string | null;
  valid_until: string | null;
  discount_type: string;
  discount_value: number;
  revision: number;
  supersedes_quote_id: string | null;
  subtotal_minor: number;
  discount_minor: number;
  vat_rate_bp: number;
  vat_minor: number;
  total_minor: number;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  viewed_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  superseded_at: string | null;
  token_expires_at: string | null;
  customer: { full_name: string; phone_e164: string } | null;
  quote_item: {
    id: string;
    service_id: string | null;
    description: string;
    quantity: number;
    unit: string;
    unit_price_minor: number;
    vat_included: boolean;
    sort_order: number;
    deleted_at: string | null;
  }[];
}

/** Agorot back to the text the editor shows: 25050 -> "250.5". */
const shekelsText = (minor: number) => String(minor / 100);

export function fromServerRow(row: QuoteRow): LocalQuote {
  const discountType = row.discount_type as DiscountType;
  return {
    id: row.id,
    businessId: row.business_id,
    customerId: row.customer_id,
    customerName: row.customer?.full_name ?? null,
    customerPhone: row.customer?.phone_e164 ?? null,
    title: row.title ?? '',
    notes: row.notes ?? '',
    validUntil: row.valid_until,
    discountType,
    discountText:
      discountType === 'percent'
        ? String(row.discount_value / 100)
        : discountType === 'amount'
          ? shekelsText(row.discount_value)
          : '',
    lines: row.quote_item
      .filter((i) => !i.deleted_at)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({
        id: i.id,
        serviceId: i.service_id,
        description: i.description,
        quantity: String(i.quantity),
        priceText: shekelsText(i.unit_price_minor),
        unit: i.unit,
        vatIncluded: i.vat_included,
      })),
    status: row.status,
    quoteNumber: row.quote_number,
    revision: row.revision,
    supersedesQuoteId: row.supersedes_quote_id,
    serverTotals: {
      subtotalMinor: row.subtotal_minor,
      discountMinor: row.discount_minor,
      vatRateBp: row.vat_rate_bp,
      vatMinor: row.vat_minor,
      totalMinor: row.total_minor,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
    viewedAt: row.viewed_at,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    cancelledAt: row.cancelled_at,
    supersededAt: row.superseded_at,
    tokenExpiresAt: row.token_expires_at,
  };
}

function apiError(error: { code?: string; message: string; name?: string }): ApiError {
  return { code: error.code, message: error.message, retryable: isNetworkError(error) };
}

const ok = <T>(data: T): ApiResult<T> => ({ data, error: null });
const fail = <T>(error: ApiError): ApiResult<T> => ({ data: null, error });

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Server side of quotes: Data API under RLS, Storage, and the `quotes` Edge Function. */
export function supabaseQuotesApi(supabase: AppSupabaseClient) {
  const api = {
    async saveDraft(payload) {
      const { error } = await supabase.rpc('save_quote_draft', { p_quote: payload as never });
      return error ? fail(apiError(error)) : ok(null);
    },

    async uploadPhoto(photo) {
      if (!photo.data) return ok(null);
      const bytes = decodeBase64(photo.data);
      const upload = await supabase.storage
        .from(QUOTE_PHOTOS_BUCKET)
        .upload(photo.path, bytes, { contentType: 'image/jpeg', upsert: true });
      if (upload.error) return fail(apiError(upload.error));
      const { error } = await supabase.from('file').upsert(
        {
          id: photo.id,
          business_id: photo.businessId,
          kind: 'quote_attachment',
          bucket: QUOTE_PHOTOS_BUCKET,
          storage_path: photo.path,
          mime_type: 'image/jpeg',
          size_bytes: bytes.length,
          quote_id: photo.quoteId,
        },
        { onConflict: 'id' },
      );
      return error ? fail(apiError(error)) : ok(null);
    },

    async deletePhoto(photoId) {
      const { error } = await supabase
        .from('file')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', photoId);
      return error ? fail(apiError(error)) : ok(null);
    },

    async send(quoteId, sendKey) {
      try {
        const { data, error } = await supabase.functions.invoke<SendQuoteResponse>(
          `quotes/${quoteId}/send`,
          { body: { sendKey } },
        );
        if (!error && data) return ok(data);
        if (error instanceof FunctionsHttpError) {
          const response = error.context as Response;
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          return fail({
            code: body.error,
            message: body.error ?? error.message,
            retryable: response.status >= 500 || response.status === 429,
          });
        }
        // Relay and fetch errors: the request may not have arrived.
        return fail({ message: error?.message ?? 'network', retryable: true });
      } catch (e) {
        return fail({ message: e instanceof Error ? e.message : 'network', retryable: true });
      }
    },

    async fetchQuote(quoteId) {
      const { data, error } = await supabase
        .from('quote')
        .select(QUOTE_COLUMNS)
        .eq('id', quoteId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) return fail(apiError(error));
      return ok(data ? fromServerRow(data as unknown as QuoteRow) : null);
    },
  } satisfies QuotesApi;

  return {
    ...api,

    async listQuotes(businessId: string): Promise<ApiResult<LocalQuote[]>> {
      const { data, error } = await supabase
        .from('quote')
        .select(QUOTE_COLUMNS)
        .eq('business_id', businessId)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(300);
      if (error) return fail(apiError(error));
      return ok((data as unknown as QuoteRow[]).map(fromServerRow));
    },

    async listPhotos(
      quoteId: string,
    ): Promise<ApiResult<Omit<LocalPhoto, 'data' | 'uploaded' | 'quoteId'>[]>> {
      const { data, error } = await supabase
        .from('file')
        .select('id, business_id, storage_path, created_at')
        .eq('quote_id', quoteId)
        .eq('bucket', QUOTE_PHOTOS_BUCKET)
        .is('deleted_at', null);
      if (error) return fail(apiError(error));
      return ok(
        data.map((f) => ({
          id: f.id,
          businessId: f.business_id,
          path: f.storage_path,
          createdAt: f.created_at,
        })),
      );
    },

    async photoUrl(path: string): Promise<string | null> {
      const { data } = await supabase.storage.from(QUOTE_PHOTOS_BUCKET).createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    },

    /** New draft revision with `newId`; the old quote becomes superseded and its link revoked. */
    async revise(quoteId: string, newId: string): Promise<ApiResult<null>> {
      const { error } = await supabase.rpc('revise_quote', {
        p_quote_id: quoteId,
        p_new_quote_id: newId,
      });
      return error ? fail(apiError(error)) : ok(null);
    },

    async cancel(quoteId: string): Promise<ApiResult<null>> {
      const { error } = await supabase.rpc('cancel_quote', { p_quote_id: quoteId });
      return error ? fail(apiError(error)) : ok(null);
    },
  };
}

export type SupabaseQuotesApi = ReturnType<typeof supabaseQuotesApi>;
