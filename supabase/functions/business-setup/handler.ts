import { BusinessSetupSchema, type BusinessTrade, type TaxStatus } from '@q2c/types';
import { corsHeaders, json } from '../_shared/http.ts';

export interface SetupBusinessArgs {
  p_business_id: string;
  p_name: string;
  p_trade: BusinessTrade;
  p_tax_status: TaxStatus;
}

export interface RpcResult {
  data: string | null;
  error: { code?: string; message: string } | null;
}

export interface Deps {
  /** Calls the setup_business RPC as the user identified by `authorization`. */
  setupBusiness(authorization: string, args: SetupBusinessArgs): Promise<RpcResult>;
}

/**
 * POST { businessId, name, trade, taxStatus } -> { businessId }
 * Validates with the same BusinessSetupSchema as the app, then runs the RPC with the
 * caller's JWT so RLS and the RPC's own checks still decide what is allowed.
 */
export async function handleBusinessSetup(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'not_authenticated' });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const parsed = BusinessSetupSchema.safeParse(body);
  if (!parsed.success) {
    return json(422, {
      error: 'validation_failed',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const { businessId, name, trade, taxStatus } = parsed.data;
  const { data, error } = await deps.setupBusiness(authorization, {
    p_business_id: businessId,
    p_name: name,
    p_trade: trade,
    p_tax_status: taxStatus,
  });

  if (error) {
    if (error.code === '28000') return json(401, { error: 'not_authenticated' });
    if (error.code === '42501') return json(403, { error: 'forbidden' });
    if (error.code === '23514') return json(422, { error: 'validation_failed', issues: [] });
    console.error('setup_business failed', error);
    return json(500, { error: 'internal_error' });
  }

  return json(200, { businessId: data });
}
