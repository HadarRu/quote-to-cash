import { describe, expect, it } from 'vitest';
import { formatPhoneIL, isE164, phoneMatches, telUrl, toE164IL, whatsappUrl } from './phone.ts';

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

describe('contact links', () => {
  it('builds tel: and wa.me links', () => {
    expect(telUrl('+972521234567')).toBe('tel:+972521234567');
    expect(whatsappUrl('+972521234567')).toBe('https://wa.me/972521234567');
  });
});

describe('phoneMatches', () => {
  it.each(['052-12', '0521234567', '+97252', '52123', '4567'])('matches %s', (typed) => {
    expect(phoneMatches('+972521234567', typed)).toBe(true);
  });

  it.each(['053', '', 'משה', '0511'])('does not match %j', (typed) => {
    expect(phoneMatches('+972521234567', typed)).toBe(false);
  });
});
