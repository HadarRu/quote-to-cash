import { describe, expect, it, vi } from 'vitest';
import { submitBusinessSetup, validateSetup, type SetupClient } from './setup.ts';

const BUSINESS_ID = '6f9619ff-8b86-4d11-b42d-00c04fc964ff';
const input = {
  businessId: BUSINESS_ID,
  name: 'כהן חשמל',
  trade: 'electrician',
  taxStatus: 'osek_patur',
} as const;
const logo = { uri: 'file:///logo.png', mimeType: 'image/png', sizeBytes: 1000 };

function client(
  overrides: {
    invoke?: Awaited<ReturnType<SetupClient['functions']['invoke']>>;
    uploadError?: unknown;
  } = {},
) {
  const upload = vi.fn().mockResolvedValue({ error: overrides.uploadError ?? null });
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq });
  const invoke = vi
    .fn()
    .mockResolvedValue(overrides.invoke ?? { data: { businessId: BUSINESS_ID }, error: null });
  const c: SetupClient = {
    functions: { invoke },
    storage: { from: vi.fn().mockReturnValue({ upload }) },
    from: vi.fn().mockReturnValue({ update }),
  };
  return { c, invoke, upload, update, eq };
}

describe('validateSetup', () => {
  it('maps schema issues to field errors', () => {
    const result = validateSetup(
      { businessId: BUSINESS_ID, name: 'א', trade: null, taxStatus: null },
      null,
    );
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        name: 'business_name_too_short',
        trade: 'trade_required',
        taxStatus: 'tax_status_required',
      },
    });
  });

  it('validates the logo against the bucket limits', () => {
    const result = validateSetup({ ...input }, { ...logo, mimeType: 'image/gif' });
    expect(result).toEqual({ ok: false, fieldErrors: { logo: 'logo_type_invalid' } });
  });

  it('returns the parsed, trimmed values', () => {
    expect(validateSetup({ ...input, name: ' כהן חשמל ' }, logo)).toEqual({
      ok: true,
      data: input,
    });
  });
});

describe('submitBusinessSetup', () => {
  it('creates the business through the Edge Function and uploads the logo', async () => {
    const { c, invoke, upload, update, eq } = client();
    const readFile = vi.fn().mockResolvedValue(new ArrayBuffer(8));
    expect(await submitBusinessSetup(c, input, logo, readFile)).toEqual({
      ok: true,
      businessId: BUSINESS_ID,
    });
    expect(invoke).toHaveBeenCalledWith('business-setup', { body: input });
    expect(upload).toHaveBeenCalledWith(`${BUSINESS_ID}/logo.png`, expect.any(ArrayBuffer), {
      contentType: 'image/png',
      upsert: true,
    });
    expect(update).toHaveBeenCalledWith({ logo_path: `${BUSINESS_ID}/logo.png` });
    expect(eq).toHaveBeenCalledWith('id', BUSINESS_ID);
  });

  it('skips Storage when there is no logo', async () => {
    const { c, upload } = client();
    expect(await submitBusinessSetup(c, input, null)).toEqual({
      ok: true,
      businessId: BUSINESS_ID,
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('maps Edge Function failures', async () => {
    const forbidden = client({
      invoke: { data: null, error: { name: 'FunctionsHttpError', context: { status: 403 } } },
    });
    expect(await submitBusinessSetup(forbidden.c, input, null)).toEqual({
      ok: false,
      error: 'forbidden',
    });

    const offline = client({ invoke: { data: null, error: { name: 'FunctionsFetchError' } } });
    expect(await submitBusinessSetup(offline.c, input, null)).toEqual({
      ok: false,
      error: 'network',
    });
  });

  it('reports a logo failure after the business was created', async () => {
    const { c } = client({ uploadError: { message: 'too large' } });
    const readFile = vi.fn().mockResolvedValue(new ArrayBuffer(8));
    expect(await submitBusinessSetup(c, input, logo, readFile)).toEqual({
      ok: false,
      error: 'logo_upload_failed',
    });
  });
});
