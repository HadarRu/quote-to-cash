import type { QuoteSnapshot } from '@q2c/types';

/** A sent quote as stored in quote.sent_snapshot, for tests. */
export function sampleSnapshot(overrides: Partial<QuoteSnapshot> = {}): QuoteSnapshot {
  return {
    quote_number: 12,
    sent_at: '2026-10-03T09:00:00Z',
    revision: 1,
    title: 'החלפת לוח חשמל',
    notes: 'המחיר כולל חומרים. אחריות לשנה.',
    valid_until: '2026-10-17',
    business: {
      name: 'כהן חשמל',
      tax_status: 'osek_murshe',
      tax_id: '512345678',
      phone: '+972521234567',
      email: 'office@cohen-electric.co.il',
      logo_path: null,
    },
    customer: { full_name: 'דנה לוי', phone: '+972541112222', address: 'הרצל 5, דירה 3, חיפה' },
    items: [
      {
        description: 'החלפת מפסק פחת Hager 40A',
        quantity: '1',
        unit: 'unit',
        unit_price_minor: 45000,
        vat_included: false,
        line_total_minor: 45000,
      },
      {
        description: 'התקנת שקע USB-C בסלון',
        quantity: '2.5',
        unit: 'point',
        unit_price_minor: 12000,
        vat_included: false,
        line_total_minor: 30000,
      },
    ],
    discount_type: 'percent',
    discount_value: 1000,
    totals: {
      subtotal_minor: 75000,
      discount_minor: 7500,
      vat_rate_bp: 1800,
      vat_minor: 12150,
      total_minor: 79650,
    },
    photos: [],
    ...overrides,
  };
}
