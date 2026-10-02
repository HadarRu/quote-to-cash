import { describe, expect, it } from 'vitest';
import { formatPhoneIL, isE164, toE164IL } from './phone.ts';

describe('toE164IL', () => {
  it.each([
    ['052-123-4567', '+972521234567'],
    ['0521234567', '+972521234567'],
    ['+972 52 123 4567', '+972521234567'],
    ['+972-052-1234567', '+972521234567'],
    ['00972521234567', '+972521234567'],
    ['972521234567', '+972521234567'],
    ['03-123-4567', '+97231234567'],
    ['077-1234567', '+972771234567'],
  ])('normalizes %s', (input, expected) => {
    expect(toE164IL(input)).toBe(expected);
  });

  it.each(['', 'abc', '052-123', '+1 212 555 0100', '0521234567890', '0612345678'])(
    'rejects %s',
    (input) => {
      expect(toE164IL(input)).toBeNull();
    },
  );
});

describe('isE164', () => {
  it('validates E.164 strings', () => {
    expect(isE164('+972521234567')).toBe(true);
    expect(isE164('0521234567')).toBe(false);
    expect(isE164('+0521234567')).toBe(false);
  });
});

describe('formatPhoneIL', () => {
  it.each([
    ['+972521234567', '052-123-4567'],
    ['+97231234567', '03-123-4567'],
    ['+12125550100', '+12125550100'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatPhoneIL(input)).toBe(expected);
  });

  it('round-trips with toE164IL', () => {
    expect(toE164IL(formatPhoneIL('+972771234567'))).toBe('+972771234567');
  });
});
