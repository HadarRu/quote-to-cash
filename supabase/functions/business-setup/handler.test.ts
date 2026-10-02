import { describe, expect, it, vi } from 'vitest';
import { handleBusinessSetup, type Deps } from './handler.ts';

const BUSINESS_ID = '6f9619ff-8b86-4d11-b42d-00c04fc964ff';
const validBody = {
  businessId: BUSINESS_ID,
  name: ' כהן חשמל ',
  trade: 'electrician',
  taxStatus: 'osek_patur',
};

function request(body: unknown, init: { method?: string; auth?: string | null } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (init.auth !== null) headers.set('Authorization', init.auth ?? 'Bearer user-jwt');
  return new Request('http://localhost/business-setup', {
    method: init.method ?? 'POST',
    headers,
    body:
      init.method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function deps(result: Awaited<ReturnType<Deps['setupBusiness']>>) {
  return { setupBusiness: vi.fn<Deps['setupBusiness']>().mockResolvedValue(result) };
}

describe('business-setup handler', () => {
  it('validates, trims and calls setup_business with the caller JWT', async () => {
    const d = deps({ data: BUSINESS_ID, error: null });
    const res = await handleBusinessSetup(request(validBody), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ businessId: BUSINESS_ID });
    expect(d.setupBusiness).toHaveBeenCalledWith('Bearer user-jwt', {
      p_business_id: BUSINESS_ID,
      p_name: 'כהן חשמל',
      p_trade: 'electrician',
      p_tax_status: 'osek_patur',
    });
  });

  it('rejects invalid input with the shared schema messages and never calls the database', async () => {
    const d = deps({ data: null, error: null });
    const res = await handleBusinessSetup(
      request({ ...validBody, name: 'א', trade: 'astronaut' }),
      d,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { issues: { path: string; message: string }[] };
    expect(body.issues).toContainEqual({ path: 'name', message: 'business_name_too_short' });
    expect(body.issues.some((i) => i.path === 'trade')).toBe(true);
    expect(d.setupBusiness).not.toHaveBeenCalled();
  });

  it('requires a bearer token', async () => {
    const d = deps({ data: null, error: null });
    expect((await handleBusinessSetup(request(validBody, { auth: null }), d)).status).toBe(401);
    expect(d.setupBusiness).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and other methods', async () => {
    const d = deps({ data: null, error: null });
    expect((await handleBusinessSetup(request('{oops'), d)).status).toBe(400);
    expect((await handleBusinessSetup(request(null, { method: 'GET' }), d)).status).toBe(405);
  });

  it('maps database permission errors to 403 and unknown errors to 500', async () => {
    const forbidden = deps({
      data: null,
      error: { code: '42501', message: 'business id already in use' },
    });
    expect((await handleBusinessSetup(request(validBody), forbidden)).status).toBe(403);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = deps({ data: null, error: { code: 'XX000', message: 'boom' } });
    const res = await handleBusinessSetup(request(validBody), broken);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal_error' });
    consoleError.mockRestore();
  });

  it('answers CORS preflight', async () => {
    const res = await handleBusinessSetup(
      request(null, { method: 'OPTIONS' }),
      deps({ data: null, error: null }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
