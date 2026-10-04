import { describe, expect, it } from 'vitest';
import { groupQueue, queueAction, rowTitle, type ActionQueueRow } from './model.ts';

const QUOTE = '80000000-0000-4000-a000-000000000001';

function row(
  kind: ActionQueueRow['kind'],
  overrides: Partial<ActionQueueRow> = {},
): ActionQueueRow {
  return {
    kind,
    id: `${kind}-1`,
    quote_id: QUOTE,
    customer_name: 'משה ישראלי',
    customer_phone: '+972521111111',
    number: 12,
    title: 'תאורה בגינה',
    amount_minor: 59000,
    since: '2026-10-01T10:00:00Z',
    event: null,
    error: null,
    ...overrides,
  };
}

describe('groupQueue', () => {
  it('returns the non-empty lists in display order, keeping row order', () => {
    const rows = [
      row('invoice_unpaid', { id: 'i1' }),
      row('quote_unanswered', { id: 'q1' }),
      row('quote_unanswered', { id: 'q2' }),
      row('push_failed', { id: 'n1' }),
    ];
    expect(groupQueue(rows).map((s) => [s.kind, s.rows.map((r) => r.id)])).toEqual([
      ['quote_unanswered', ['q1', 'q2']],
      ['invoice_unpaid', ['i1']],
      ['push_failed', ['n1']],
    ]);
  });

  it('is empty when nothing waits', () => {
    expect(groupQueue([])).toEqual([]);
  });
});

describe('queueAction', () => {
  it('a sent quote opens WhatsApp with a prefilled reminder', () => {
    const action = queueAction(row('quote_unanswered'), 'כהן חשמל');
    expect(action?.type).toBe('whatsapp');
    const url = (action as { url: string }).url;
    expect(url.startsWith('https://wa.me/972521111111?text=')).toBe(true);
    const text = decodeURIComponent(url.split('?text=')[1]!);
    expect(text).toContain('משה ישראלי');
    expect(text).toContain('כהן חשמל');
    expect(text).toContain('12');
  });

  it('an unpaid invoice opens WhatsApp with the amount due', () => {
    const action = queueAction(
      row('invoice_unpaid', { number: 7, amount_minor: 100000 }),
      'כהן חשמל',
    );
    const text = decodeURIComponent((action as { url: string }).url.split('?text=')[1]!);
    expect(text).toContain('7');
    expect(text).toContain('1,000.00');
  });

  it('scheduling and invoicing open the quote', () => {
    expect(queueAction(row('approved_unscheduled'), 'b')).toEqual({
      type: 'quote',
      quoteId: QUOTE,
    });
    expect(queueAction(row('completed_uninvoiced'), 'b')).toEqual({
      type: 'quote',
      quoteId: QUOTE,
    });
    expect(queueAction(row('completed_uninvoiced', { quote_id: null }), 'b')).toBeNull();
  });

  it('a failed push is dismissed', () => {
    expect(queueAction(row('push_failed', { id: 'n1' }), 'b')).toEqual({
      type: 'dismiss',
      notificationId: 'n1',
    });
  });
});

describe('rowTitle', () => {
  it('names the customer and the document', () => {
    expect(rowTitle(row('quote_unanswered'))).toBe('משה ישראלי · הצעה מס׳ 12');
    expect(rowTitle(row('invoice_unpaid', { number: 7 }))).toBe('משה ישראלי · חשבונית מס׳ 7');
    expect(rowTitle(row('completed_uninvoiced', { number: null }))).toBe(
      'משה ישראלי · תאורה בגינה',
    );
  });

  it('says which push did not arrive', () => {
    expect(rowTitle(row('push_failed', { event: 'quote_approved' }))).toBe(
      'ההצעה אושרה · משה ישראלי · הצעה מס׳ 12',
    );
  });
});
