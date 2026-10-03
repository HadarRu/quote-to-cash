import { describe, expect, it } from 'vitest';
import { PhoneSchema, phoneE164Schema } from './phone.ts';

describe('PhoneSchema', () => {
  it.each([
    ['052-123-4567', '+972521234567'],
    [' +972 52 123 4567 ', '+972521234567'],
    ['00972521234567', '+972521234567'],
    ['03-123-4567', '+97231234567'],
  ])('normalizes %s to E.164', (input, expected) => {
    expect(PhoneSchema.parse(input)).toBe(expected);
  });

  it.each(['', '123', '+1 212 555 0100', '0521234567890'])(
    'rejects %j with phone_invalid',
    (input) => {
      const result = PhoneSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe('phone_invalid');
    },
  );

  it('produces values accepted by phoneE164Schema', () => {
    expect(phoneE164Schema.safeParse(PhoneSchema.parse('0501234567')).success).toBe(true);
  });
});
