import {
  businessVatRateBp,
  SendQuoteRequestSchema,
  type QuoteSnapshot,
  type SendQuoteResponse,
  type TaxStatus,
} from '@q2c/types';
import { format, strings } from '@q2c/ui';
import {
  addDays,
  computeQuoteTotals,
  formatAddressLine,
  dateInJerusalem,
  endOfDayInJerusalem,
  whatsappUrl,
  type DiscountType,
} from '@q2c/utils';
import { corsHeaders, json } from '../_shared/http.ts';
import { hashToken, newToken } from '../_shared/token.ts';

export { hashToken };

/** A quote with everything the customer will see, as read with the caller's JWT (RLS). */
export interface QuoteForSend {
  id: string;
  businessId: string;
  status: string;
  title: string | null;
  notes: string | null;
  validUntil: string | null;
  discountType: DiscountType;
  discountValue: number;
  revision: number;
  business: {
    name: string;
    taxStatus: TaxStatus;
    phone: string | null;
    email: string | null;
    taxId: string | null;
    logoPath: string | null;
    vatRateBp: number;
    quoteValidDays: number;
  };
  customer: {
    fullName: string;
    phone: string;
    address: string | null;
  };
  items: {
    description: string;
    /** numeric(12,3) as read from the database. */
    quantity: number | string;
    unit: string;
    unitPriceMinor: number;
    vatIncluded: boolean;
  }[];
  /** quote-photos storage paths, in order. */
  photoPaths: string[];
}

export interface SendQuoteArgs {
  p_user_id: string;
  p_quote_id: string;
  p_send_key: string;
  p_token_hash: string;
  p_token_expires_at: string;
  p_totals: Record<string, number>;
  p_snapshot: QuoteSnapshot;
}

export interface SendQuoteRow {
  quote_number: number;
  sent_at: string;
  already_sent: boolean;
  token_stored: boolean;
}

type DbError = { code?: string; message: string };

export interface Deps {
  /** The user behind the bearer token, or null when it is invalid or expired. */
  getUserId(authorization: string): Promise<string | null>;
  /** Reads the quote as that user (RLS), so other businesses' quotes are not found. */
  loadQuote(
    authorization: string,
    quoteId: string,
  ): Promise<{ data: QuoteForSend | null; error: DbError | null }>;
  /** The send_quote RPC, as service_role. */
  sendQuote(args: SendQuoteArgs): Promise<{ data: SendQuoteRow | null; error: DbError | null }>;
  tokenPepper: string;
  /** Base URL of the public web app, e.g. https://app.example.com */
  publicAppUrl: string;
  now?: () => Date;
  randomBytes?: (length: number) => Uint8Array;
}

const SEND_PATH =
  /\/quotes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/send\/?$/i;
/**
 * POST /quotes/:id/send { sendKey } -> SendQuoteResponse
 *
 * Sends a DRAFT quote: recomputes the totals from the stored lines (the app's
 * totals are only a preview), freezes a snapshot of what the customer sees,
 * creates a random customer link token (only its peppered hash is stored) and
 * lets send_quote assign the number. Retrying with the same sendKey returns
 * the same number and a working link.
 */
export async function handleQuotes(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const match = SEND_PATH.exec(new URL(req.url).pathname);
  if (!match) return json(404, { error: 'not_found' });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const quoteId = match[1]!.toLowerCase();

  if (!deps.tokenPepper || !deps.publicAppUrl) {
    console.error('quotes: TOKEN_PEPPER and PUBLIC_APP_URL must be set');
    return json(500, { error: 'internal_error' });
  }

  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'not_authenticated' });
  const userId = await deps.getUserId(authorization);
  if (!userId) return json(401, { error: 'not_authenticated' });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }
  const parsed = SendQuoteRequestSchema.safeParse(body);
  if (!parsed.success) return json(422, { error: 'validation_failed' });

  const loaded = await deps.loadQuote(authorization, quoteId);
  if (loaded.error) {
    console.error('quotes: load failed', loaded.error);
    return json(500, { error: 'internal_error' });
  }
  const quote = loaded.data;
  if (!quote) return json(404, { error: 'quote_not_found' });

  // Authoritative totals, from the lines as stored.
  let totals;
  try {
    totals = computeQuoteTotals({
      lines: quote.items,
      discountType: quote.discountType,
      discountValue: quote.discountValue,
      vatRateBp: businessVatRateBp(quote.business.taxStatus, quote.business.vatRateBp),
    });
  } catch {
    return json(422, { error: 'validation_failed' });
  }

  const now = (deps.now ?? (() => new Date()))();
  const today = dateInJerusalem(now);
  const validUntil = quote.validUntil ?? addDays(today, quote.business.quoteValidDays);
  if (validUntil < today) return json(422, { error: 'quote_valid_until_past' });
  const expiresAt = endOfDayInJerusalem(validUntil);

  const token = newToken(deps.randomBytes);
  const tokenHash = await hashToken(token, deps.tokenPepper);

  const snapshot: QuoteSnapshot = {
    revision: quote.revision,
    title: quote.title,
    notes: quote.notes,
    valid_until: validUntil,
    business: {
      name: quote.business.name,
      tax_status: quote.business.taxStatus,
      tax_id: quote.business.taxId,
      phone: quote.business.phone,
      email: quote.business.email,
      logo_path: quote.business.logoPath,
    },
    customer: {
      full_name: quote.customer.fullName,
      phone: quote.customer.phone,
      address: quote.customer.address,
    },
    items: quote.items.map((item, i) => ({
      description: item.description,
      quantity: String(item.quantity),
      unit: item.unit,
      unit_price_minor: item.unitPriceMinor,
      vat_included: item.vatIncluded,
      line_total_minor: totals.lineTotalsMinor[i]!,
    })),
    discount_type: quote.discountType,
    discount_value: quote.discountValue,
    totals: {
      subtotal_minor: totals.subtotalMinor,
      discount_minor: totals.discountMinor,
      vat_rate_bp: totals.vatRateBp,
      vat_minor: totals.vatMinor,
      total_minor: totals.totalMinor,
    },
    photos: quote.photoPaths,
  };

  const { data, error } = await deps.sendQuote({
    p_user_id: userId,
    p_quote_id: quote.id,
    p_send_key: parsed.data.sendKey,
    p_token_hash: tokenHash,
    p_token_expires_at: expiresAt.toISOString(),
    p_totals: snapshot.totals,
    p_snapshot: snapshot,
  });
  if (error || !data) {
    if (error?.code === '42501') return json(404, { error: 'quote_not_found' });
    if (error?.code === '55000') return json(409, { error: 'quote_not_draft' });
    if (error?.code === '22023') return json(422, { error: 'quote_lines_required' });
    console.error('quotes: send_quote failed', error);
    return json(500, { error: 'internal_error' });
  }

  const url = data.token_stored ? `${deps.publicAppUrl.replace(/\/+$/, '')}/quote/${token}` : null;
  const message = url
    ? format(strings.quotes.whatsappMessage, {
        customer: quote.customer.fullName,
        business: quote.business.name,
        number: data.quote_number,
        url,
      })
    : null;
  const response: SendQuoteResponse = {
    quoteNumber: data.quote_number,
    sentAt: data.sent_at,
    url,
    whatsappUrl: message
      ? `${whatsappUrl(quote.customer.phone)}?text=${encodeURIComponent(message)}`
      : null,
    alreadySent: data.already_sent,
  };
  return json(200, response);
}

/** The row read by QUOTE_SELECT. */
export interface QuoteRow {
  id: string;
  business_id: string;
  status: string;
  title: string | null;
  notes: string | null;
  valid_until: string | null;
  discount_type: string;
  discount_value: number;
  revision: number;
  business: {
    name: string;
    tax_status: string;
    phone_e164: string | null;
    email: string | null;
    tax_id: string | null;
    logo_path: string | null;
    business_settings:
      | { vat_rate_bp: number; quote_valid_days: number }
      | { vat_rate_bp: number; quote_valid_days: number }[];
  };
  customer: { full_name: string; phone_e164: string };
  customer_address: {
    street: string;
    house_number: string | null;
    apartment: string | null;
    city: string;
  } | null;
  quote_item: {
    description: string;
    quantity: number;
    unit: string;
    unit_price_minor: number;
    vat_included: boolean;
    sort_order: number;
    deleted_at: string | null;
  }[];
  file: { storage_path: string; created_at: string; deleted_at: string | null }[];
}

/** Columns and embeds that make up a QuoteRow. */
export const QUOTE_SELECT = `id, business_id, status, title, notes, valid_until, discount_type, discount_value, revision,
  business (name, tax_status, phone_e164, email, tax_id, logo_path, business_settings (vat_rate_bp, quote_valid_days)),
  customer (full_name, phone_e164),
  customer_address (street, house_number, apartment, city),
  quote_item (description, quantity, unit, unit_price_minor, vat_included, sort_order, deleted_at),
  file (storage_path, created_at, deleted_at)`;

export function toQuoteForSend(row: QuoteRow): QuoteForSend {
  const settings = Array.isArray(row.business.business_settings)
    ? row.business.business_settings[0]!
    : row.business.business_settings;
  const address = row.customer_address;
  return {
    id: row.id,
    businessId: row.business_id,
    status: row.status,
    title: row.title,
    notes: row.notes,
    validUntil: row.valid_until,
    discountType: row.discount_type as DiscountType,
    discountValue: row.discount_value,
    revision: row.revision,
    business: {
      name: row.business.name,
      taxStatus: row.business.tax_status as TaxStatus,
      phone: row.business.phone_e164,
      email: row.business.email,
      taxId: row.business.tax_id,
      logoPath: row.business.logo_path,
      vatRateBp: settings.vat_rate_bp,
      quoteValidDays: settings.quote_valid_days,
    },
    customer: {
      fullName: row.customer.full_name,
      phone: row.customer.phone_e164,
      address: address
        ? formatAddressLine(
            {
              street: address.street,
              houseNumber: address.house_number,
              apartment: address.apartment,
              city: address.city,
            },
            strings.customers.apartmentLabel,
          )
        : null,
    },
    items: row.quote_item
      .filter((i) => !i.deleted_at)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({
        description: i.description,
        quantity: i.quantity,
        unit: i.unit,
        unitPriceMinor: i.unit_price_minor,
        vatIncluded: i.vat_included,
      })),
    photoPaths: row.file
      .filter((f) => !f.deleted_at)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((f) => f.storage_path),
  };
}
