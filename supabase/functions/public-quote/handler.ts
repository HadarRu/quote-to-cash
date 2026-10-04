import {
  PublicQuoteApproveSchema,
  PublicQuoteCommentSchema,
  PublicQuoteRejectSchema,
  PublicQuoteScheduleSchema,
  QUOTE_TOKEN_PATTERN,
  type PublicQuoteView,
  type QuoteSnapshot,
} from '@q2c/types';
import { json } from '../_shared/http.ts';
import { hashToken } from '../_shared/token.ts';

/** What the database functions return for a link (see 20261004000000_public_quote.sql). */
export type DbView =
  | { state: 'cancelled' | 'superseded'; business: { name: string } }
  | {
      state: 'open' | 'approved' | 'rejected' | 'expired';
      quote: QuoteSnapshot;
      expires_at: string | null;
      approval: { name: string; at: string } | null;
      rejection: { reason: string | null; at: string } | null;
      slots: { id: string; starts_at: string; ends_at: string; available: boolean }[];
      appointment: { slot_id: string; starts_at: string; ends_at: string } | null;
      already?: boolean;
    };

type DbError = { code?: string; message: string };
type DbResult<T> = { data: T | null; error: DbError | null };

export interface Deps {
  tokenPepper: string;
  /** One request in `bucket`; false once over `limit` per `windowSeconds`. */
  hitRateLimit(bucket: string, limit: number, windowSeconds: number): Promise<boolean>;
  open(tokenHash: string, ip: string | null): Promise<DbResult<DbView>>;
  respond(
    tokenHash: string,
    action: 'approve' | 'reject',
    name: string | null,
    reason: string | null,
    ip: string | null,
  ): Promise<DbResult<DbView>>;
  comment(tokenHash: string, body: string, ip: string | null): Promise<DbResult<boolean>>;
  schedule(tokenHash: string, slotId: string, ip: string | null): Promise<DbResult<DbView>>;
  /** Signed URLs for the logo (business-assets) and photos (quote-photos). */
  signUrls(
    logoPath: string | null,
    photoPaths: string[],
  ): Promise<{ logoUrl: string | null; photoUrls: string[] }>;
}

/** Requests per minute. Guessing tokens is hopeless (2^256), and these keep it that way cheaply. */
export const LIMITS = {
  /** Page loads from one IP. */
  ipRead: 60,
  /** Answers and comments from one IP. */
  ipWrite: 10,
  /** Any request for one link, from anywhere. */
  token: 30,
} as const;

type Action = 'approve' | 'reject' | 'comment' | 'schedule';

const PATH = /\/public-quote\/([^/]+)(?:\/(approve|reject|comment|schedule))?\/?$/;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

/** Unknown, malformed and revoked links all get exactly this. */
const notFound = () => json(404, { error: 'not_found' });

/** The caller's address as the platform reports it (first X-Forwarded-For entry). */
export function clientIp(req: Request): string | null {
  const first = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!first) return null;
  return /^[0-9a-fA-F:.]{2,45}$/.test(first) ? first : null;
}

/**
 * The customer's side of a quote, behind the link token (no sign-in):
 *   GET  /public-quote/:token          the quote (first open marks it VIEWED)
 *   POST /public-quote/:token/approve  { name }
 *   POST /public-quote/:token/reject   { reason? }
 *   POST /public-quote/:token/comment  { body }
 *   POST /public-quote/:token/schedule { slotId }  book a proposed time (approved quotes);
 *        409 { error: 'conflict' } when the time is no longer free
 */
export async function handlePublicQuote(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const withCors = (res: Response) => {
    for (const [k, v] of Object.entries(corsHeaders)) res.headers.set(k, v);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  };

  const match = PATH.exec(new URL(req.url).pathname);
  if (!match) return withCors(notFound());
  const [, token, action] = match as unknown as [string, string, Action | undefined];
  if ((action && req.method !== 'POST') || (!action && req.method !== 'GET'))
    return withCors(json(405, { error: 'method_not_allowed' }));

  if (!deps.tokenPepper) {
    console.error('public-quote: TOKEN_PEPPER must be set');
    return withCors(json(500, { error: 'internal_error' }));
  }

  const ip = clientIp(req);
  const ipLimit = action ? LIMITS.ipWrite : LIMITS.ipRead;
  if (!(await deps.hitRateLimit(`ip:${action ? 'w' : 'r'}:${ip ?? 'unknown'}`, ipLimit, 60)))
    return withCors(json(429, { error: 'rate_limited' }));

  if (!QUOTE_TOKEN_PATTERN.test(token)) return withCors(notFound());
  const tokenHash = await hashToken(token, deps.tokenPepper);
  if (!(await deps.hitRateLimit(`token:${tokenHash}`, LIMITS.token, 60)))
    return withCors(json(429, { error: 'rate_limited' }));

  try {
    return withCors(await route(req, deps, tokenHash, action, ip));
  } catch (error) {
    console.error('public-quote failed', error);
    return withCors(json(500, { error: 'internal_error' }));
  }
}

async function route(
  req: Request,
  deps: Deps,
  tokenHash: string,
  action: Action | undefined,
  ip: string | null,
): Promise<Response> {
  if (!action) {
    const { data, error } = await deps.open(tokenHash, ip);
    if (error) return dbFailure(error);
    return data ? json(200, await toView(deps, data)) : notFound();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  if (action === 'comment') {
    const parsed = PublicQuoteCommentSchema.safeParse(body);
    if (!parsed.success) return json(422, { error: parsed.error.issues[0]?.message });
    const { data, error } = await deps.comment(tokenHash, parsed.data.body, ip);
    if (error) return dbFailure(error);
    return data ? json(200, { ok: true }) : notFound();
  }

  if (action === 'schedule') {
    const parsed = PublicQuoteScheduleSchema.safeParse(body);
    if (!parsed.success) return json(422, { error: parsed.error.issues[0]?.message });
    const { data, error } = await deps.schedule(tokenHash, parsed.data.slotId, ip);
    if (error) return dbFailure(error);
    return data ? json(200, await toView(deps, data)) : notFound();
  }

  let name: string | null = null;
  let reason: string | null = null;
  if (action === 'approve') {
    const parsed = PublicQuoteApproveSchema.safeParse(body);
    if (!parsed.success) return json(422, { error: parsed.error.issues[0]?.message });
    name = parsed.data.name;
  } else {
    const parsed = PublicQuoteRejectSchema.safeParse(body ?? {});
    if (!parsed.success) return json(422, { error: parsed.error.issues[0]?.message });
    reason = parsed.data.reason ?? null;
  }
  const { data, error } = await deps.respond(tokenHash, action, name, reason, ip);
  if (error) return dbFailure(error);
  return data ? json(200, await toView(deps, data)) : notFound();
}

function dbFailure(error: DbError): Response {
  if (error.code === '55000') return json(409, { error: 'quote_closed' });
  // The time overlaps another confirmed visit (exclusion constraint) or has passed.
  if (error.code === '23P01') return json(409, { error: 'conflict' });
  if (error.code === '23505') return json(409, { error: 'already_scheduled' });
  if (error.code === '22023') return json(422, { error: 'validation_failed' });
  console.error('public-quote: database error', error);
  return json(500, { error: 'internal_error' });
}

async function toView(deps: Deps, view: DbView): Promise<PublicQuoteView & { already?: boolean }> {
  if (!('quote' in view)) return { state: view.state, business: { name: view.business.name } };
  const { logoUrl, photoUrls } = await deps.signUrls(
    view.quote.business.logo_path,
    view.quote.photos ?? [],
  );
  return {
    state: view.state,
    quote: view.quote,
    expiresAt: view.expires_at,
    approval: view.approval,
    rejection: view.rejection,
    logoUrl,
    photoUrls,
    slots: (view.slots ?? []).map((slot) => ({
      id: slot.id,
      startsAt: slot.starts_at,
      endsAt: slot.ends_at,
      available: slot.available,
    })),
    appointment: view.appointment
      ? {
          slotId: view.appointment.slot_id,
          startsAt: view.appointment.starts_at,
          endsAt: view.appointment.ends_at,
        }
      : null,
    ...(view.already === undefined ? {} : { already: view.already }),
  };
}
