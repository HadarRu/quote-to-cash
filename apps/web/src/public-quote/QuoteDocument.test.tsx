import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { sampleSnapshot } from './fixtures';
import { QuoteDocument } from './QuoteDocument';

const attack = '<script>alert(1)</script><img src=x onerror=alert(2)>"\'&';

describe('QuoteDocument', () => {
  it('escapes every value from the quote, the approval and the rejection', () => {
    const base = sampleSnapshot();
    const html = renderToStaticMarkup(
      <QuoteDocument
        quote={sampleSnapshot({
          title: attack,
          notes: attack,
          business: { ...base.business, name: attack, email: attack, tax_id: attack },
          customer: { full_name: attack, phone: '+972541112222', address: attack },
          items: [{ ...base.items[0]!, description: attack, unit: attack, quantity: attack }],
        })}
        logoUrl={null}
        photoUrls={[]}
        approval={{ name: attack, at: '2026-10-03T10:00:00Z' }}
        rejection={{ reason: attack, at: '2026-10-03T10:00:00Z' }}
      />,
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toMatch(/<[^>]*\sonerror=/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // Every injected copy is escaped (none slipped through as markup).
    expect(html.split('&lt;script&gt;').length - 1).toBeGreaterThanOrEqual(10);
  });

  it('shows number, customer, items, totals and approval details', () => {
    const html = renderToStaticMarkup(
      <QuoteDocument
        quote={sampleSnapshot()}
        logoUrl="https://storage.test/logo.png?sig"
        photoUrls={['https://storage.test/p1.jpg?sig']}
        approval={{ name: 'דנה לוי', at: '2026-10-03T10:00:00Z' }}
        rejection={null}
      />,
    );
    for (const text of [
      'הצעת מחיר מספר 12',
      'דנה לוי',
      'החלפת מפסק פחת Hager 40A',
      '2.5 נקודה',
      'הנחה',
      'מע״מ (18%)',
      'אושרה על ידי דנה לוי ב־03.10.2026, 13:00',
      'https://storage.test/p1.jpg?sig',
    ])
      expect(html).toContain(text);
    expect(html).toContain('796.50');
  });
});
