import {
  RegisterDeviceRequestSchema,
  UnregisterDeviceRequestSchema,
  type RegisterDeviceRequest,
} from '@q2c/types';
import { json } from '../_shared/http.ts';

type DbError = { code?: string; message: string };

export interface Deps {
  /** register_device as the caller (their JWT), so membership is checked by the database. */
  register(
    authorization: string,
    input: RegisterDeviceRequest,
  ): Promise<{ data: string | null; error: DbError | null }>;
  unregister(authorization: string, token: string): Promise<{ error: DbError | null }>;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
};

const PATH = /\/devices\/?$/;

/**
 * Push token registration for the signed-in member:
 *   POST   /devices { businessId, token, platform } -> { id }
 *   DELETE /devices { token }                        -> { ok: true }
 */
export async function handleDevices(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const withCors = (res: Response) => {
    for (const [k, v] of Object.entries(corsHeaders)) res.headers.set(k, v);
    return res;
  };

  if (!PATH.test(new URL(req.url).pathname)) return withCors(json(404, { error: 'not_found' }));
  if (req.method !== 'POST' && req.method !== 'DELETE')
    return withCors(json(405, { error: 'method_not_allowed' }));

  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer '))
    return withCors(json(401, { error: 'not_authenticated' }));

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return withCors(json(400, { error: 'invalid_json' }));
  }

  if (req.method === 'DELETE') {
    const parsed = UnregisterDeviceRequestSchema.safeParse(body);
    if (!parsed.success) return withCors(json(422, { error: 'push_token_invalid' }));
    const { error } = await deps.unregister(authorization, parsed.data.token);
    return withCors(error ? failure(error) : json(200, { ok: true }));
  }

  const parsed = RegisterDeviceRequestSchema.safeParse(body);
  if (!parsed.success) return withCors(json(422, { error: parsed.error.issues[0]?.message }));
  const { data, error } = await deps.register(authorization, parsed.data);
  return withCors(error || !data ? failure(error) : json(200, { id: data }));
}

function failure(error: DbError | null): Response {
  if (error?.code === '42501') return json(403, { error: 'forbidden' });
  if (error?.code === '23514' || error?.code === '22P02')
    return json(422, { error: 'push_token_invalid' });
  if (error?.code === 'PGRST301' || error?.code === '401')
    return json(401, { error: 'not_authenticated' });
  console.error('devices: database error', error);
  return json(500, { error: 'internal_error' });
}
