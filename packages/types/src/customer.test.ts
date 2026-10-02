import { describe, expect, it } from 'vitest';
import { CustomerSchema, QuickCustomerSchema } from './customer.ts';

const id = '6f9619ff-8b86-4d11-b42d-00c04fc964ff';
const messages = (input: unknown) =>
  CustomerSchema.safeParse(input).error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ??
  [];

describe('CustomerSchema', () => {
  it('requires name and phone, normalizes the phone and drops empty optionals', () => {
    expect(
      CustomerSchema.parse({
        id,
        fullName: '  משה כהן ',
        phone: '052-123-4567',
        email: '',
        notes: '  ',
      }),
    ).toEqual({
      id,
      fullName: 'משה כהן',
      phone: '+972521234567',
      email: undefined,
      notes: undefined,
    });
  });

  it('reports each invalid field with its i18n key', () => {
    expect(messages({ id, fullName: 'מ', phone: '123', email: 'nope' })).toEqual([
      'fullName:customer_name_too_short',
      'phone:phone_invalid',
      'email:email_invalid',
    ]);
  });

  it('accepts and normalizes an optional address', () => {
    const parsed = CustomerSchema.parse({
      id,
      fullName: 'משה כהן',
      phone: '0521234567',
      email: 'Moshe@Example.com',
      address: {
        street: 'הרצל',
        houseNumber: '10',
        city: 'חיפה',
        postalCode: '31-000-00',
        apartment: '',
      },
    });
    expect(parsed.email).toBe('moshe@example.com');
    expect(parsed.address).toEqual({
      street: 'הרצל',
      houseNumber: '10',
      apartment: undefined,
      city: 'חיפה',
      postalCode: '3100000',
    });
  });

  it('rejects an incomplete address and a bad postal code', () => {
    expect(
      messages({
        id,
        fullName: 'משה כהן',
        phone: '0521234567',
        address: { street: '', city: 'חיפה', postalCode: '123' },
      }),
    ).toEqual(['address.street:address_street_required', 'address.postalCode:postal_code_invalid']);
  });
});

describe('QuickCustomerSchema', () => {
  it('needs only id, name and phone', () => {
    expect(QuickCustomerSchema.parse({ id, fullName: 'דנה', phone: '+972 54 765 4321' })).toEqual({
      id,
      fullName: 'דנה',
      phone: '+972547654321',
    });
    expect(QuickCustomerSchema.safeParse({ id, fullName: 'דנה' }).success).toBe(false);
  });
});
