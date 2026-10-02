import { describe, expect, it } from 'vitest';
import {
  filterCustomers,
  prefillFromQuery,
  validateCustomerForm,
  type CustomerFormValues,
} from './model.ts';

const customers = [
  {
    id: '1',
    fullName: 'משה כהן',
    phone: '+972521234567',
    email: null,
    updatedAt: '2026-10-02T10:00:00Z',
  },
  {
    id: '2',
    fullName: 'דנה לוי',
    phone: '+972547654321',
    email: 'dana@example.com',
    updatedAt: '2026-10-01T10:00:00Z',
  },
  {
    id: '3',
    fullName: 'משה לוי',
    phone: '+97231234567',
    email: null,
    updatedAt: '2026-09-30T10:00:00Z',
  },
];

describe('filterCustomers', () => {
  it('returns everything (most recent first, as given) for an empty query', () => {
    expect(filterCustomers(customers, '  ').map((c) => c.id)).toEqual(['1', '2', '3']);
  });

  it('matches every word of the name in any order', () => {
    expect(filterCustomers(customers, 'משה').map((c) => c.id)).toEqual(['1', '3']);
    expect(filterCustomers(customers, 'לוי  משה').map((c) => c.id)).toEqual(['3']);
  });

  it('matches phone fragments in national or international form', () => {
    expect(filterCustomers(customers, '054-765').map((c) => c.id)).toEqual(['2']);
    expect(filterCustomers(customers, '+9723').map((c) => c.id)).toEqual(['3']);
    expect(filterCustomers(customers, '4567').map((c) => c.id)).toEqual(['1', '3']);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterCustomers(customers, 'יוסי')).toEqual([]);
  });
});

describe('prefillFromQuery', () => {
  it('puts digits in the phone and text in the name', () => {
    expect(prefillFromQuery('052-123')).toEqual({ fullName: '', phone: '052-123' });
    expect(prefillFromQuery(' יוסי ')).toEqual({ fullName: 'יוסי', phone: '' });
  });
});

describe('validateCustomerForm', () => {
  const base: CustomerFormValues = {
    id: '6f9619ff-8b86-4d11-b42d-00c04fc964ff',
    fullName: 'משה כהן',
    phone: '052-123-4567',
    email: 'bad',
    notes: '',
    address: {
      id: 'a',
      street: '',
      houseNumber: '',
      apartment: '',
      city: '',
      postalCode: '',
      accessNotes: '',
    },
  };

  it('quick mode only validates name and phone', () => {
    const result = validateCustomerForm(base, 'quick');
    expect(result).toEqual({
      ok: true,
      data: { id: base.id, fullName: 'משה כהן', phone: '+972521234567' },
    });
  });

  it('full mode reports field errors by path', () => {
    expect(validateCustomerForm(base, 'full')).toEqual({
      ok: false,
      fieldErrors: {
        email: 'email_invalid',
        'address.street': 'address_street_required',
        'address.city': 'address_city_required',
      },
    });
  });

  it('requires name and phone', () => {
    expect(
      validateCustomerForm({ ...base, fullName: '', phone: '', email: '', address: null }, 'full'),
    ).toEqual({
      ok: false,
      fieldErrors: { fullName: 'customer_name_too_short', phone: 'phone_invalid' },
    });
  });
});
