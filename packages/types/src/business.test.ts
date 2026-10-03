import { describe, expect, it } from 'vitest';
import { BusinessLogoSchema, BusinessSetupSchema, LOGO_MAX_BYTES } from './business.ts';

const valid = {
  businessId: '6f9619ff-8b86-4d11-b42d-00c04fc964ff',
  name: '  כהן חשמל  ',
  trade: 'electrician',
  taxStatus: 'osek_murshe',
};

const firstMessage = (input: unknown) =>
  BusinessSetupSchema.safeParse(input).error?.issues[0]?.message;

describe('BusinessSetupSchema', () => {
  it('accepts a valid setup and trims the name', () => {
    expect(BusinessSetupSchema.parse(valid)).toEqual({ ...valid, name: 'כהן חשמל' });
  });

  it('rejects names that are too short or too long', () => {
    expect(firstMessage({ ...valid, name: ' א ' })).toBe('business_name_too_short');
    expect(firstMessage({ ...valid, name: 'א'.repeat(81) })).toBe('business_name_too_long');
  });

  it('rejects unknown trades and tax statuses (enums come from the database)', () => {
    expect(BusinessSetupSchema.safeParse({ ...valid, trade: 'astronaut' }).success).toBe(false);
    expect(BusinessSetupSchema.safeParse({ ...valid, taxStatus: 'exempt' }).success).toBe(false);
  });

  it('requires a UUID business id', () => {
    expect(firstMessage({ ...valid, businessId: '42' })).toBe('business_id_invalid');
  });
});

describe('BusinessLogoSchema', () => {
  it('accepts PNG, JPEG and WebP up to the bucket limit', () => {
    expect(
      BusinessLogoSchema.safeParse({ mimeType: 'image/png', sizeBytes: LOGO_MAX_BYTES }).success,
    ).toBe(true);
  });

  it('rejects other types and oversized files', () => {
    expect(
      BusinessLogoSchema.safeParse({ mimeType: 'image/gif', sizeBytes: 10 }).error?.issues[0]
        ?.message,
    ).toBe('logo_type_invalid');
    expect(
      BusinessLogoSchema.safeParse({ mimeType: 'image/png', sizeBytes: LOGO_MAX_BYTES + 1 }).error
        ?.issues[0]?.message,
    ).toBe('logo_too_large');
  });
});
