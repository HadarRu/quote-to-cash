import { ACTION_QUEUE_KINDS, type ActionQueueKind, type NotificationEvent } from '@q2c/types';
import { format, strings } from '@q2c/ui';
import { formatMoney, whatsappUrl } from '@q2c/utils';

/** A row of action_queue() (see 20261005100000_notifications.sql). */
export interface ActionQueueRow {
  kind: ActionQueueKind;
  /** The quote, job, invoice or notification the row is about. */
  id: string;
  quote_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  number: number | null;
  title: string | null;
  amount_minor: number | null;
  since: string | null;
  event: NotificationEvent | null;
  error: string | null;
}

export interface ActionQueueSection {
  kind: ActionQueueKind;
  rows: ActionQueueRow[];
}

/** Non-empty lists in display order; rows keep the server's order (oldest first). */
export function groupQueue(rows: ActionQueueRow[]): ActionQueueSection[] {
  return ACTION_QUEUE_KINDS.map((kind) => ({
    kind,
    rows: rows.filter((r) => r.kind === kind),
  })).filter((s) => s.rows.length > 0);
}

/** What a row's button does. */
export type QueueAction =
  | { type: 'whatsapp'; url: string }
  | { type: 'quote'; quoteId: string }
  | { type: 'dismiss'; notificationId: string }
  | null;

/**
 * The row's action. Scheduling and invoicing open the quote the work came
 * from (the scheduling and invoicing screens hang off it).
 */
export function queueAction(row: ActionQueueRow, businessName: string): QueueAction {
  switch (row.kind) {
    case 'quote_unanswered':
      if (!row.customer_phone) return null;
      return {
        type: 'whatsapp',
        url: whatsappWithText(
          row.customer_phone,
          format(strings.actionQueue.quoteReminder, {
            customer: row.customer_name ?? '',
            business: businessName,
            number: row.number ?? '',
          }),
        ),
      };
    case 'invoice_unpaid':
      if (!row.customer_phone) return null;
      return {
        type: 'whatsapp',
        url: whatsappWithText(
          row.customer_phone,
          format(strings.actionQueue.paymentReminder, {
            customer: row.customer_name ?? '',
            business: businessName,
            number: row.number ?? '',
            amount: formatMoney(row.amount_minor ?? 0),
          }),
        ),
      };
    case 'approved_unscheduled':
    case 'completed_uninvoiced':
      return row.quote_id ? { type: 'quote', quoteId: row.quote_id } : null;
    case 'push_failed':
      return { type: 'dismiss', notificationId: row.id };
  }
}

function whatsappWithText(phone: string, text: string): string {
  return `${whatsappUrl(phone)}?text=${encodeURIComponent(text)}`;
}

/** The row's main line: customer, then the quote or invoice number. */
export function rowTitle(row: ActionQueueRow): string {
  const number =
    row.number === null
      ? null
      : format(
          row.kind === 'invoice_unpaid' ||
            row.event === 'invoice_issued' ||
            row.event === 'payment_received'
            ? strings.actionQueue.invoiceNumber
            : strings.actionQueue.quoteNumber,
          { number: row.number },
        );
  if (row.kind === 'push_failed') {
    const what = row.event ? strings.notifications.push[row.event] : null;
    return [what, row.customer_name, number].filter(Boolean).join(' · ');
  }
  return [row.customer_name, number ?? row.title].filter(Boolean).join(' · ');
}
