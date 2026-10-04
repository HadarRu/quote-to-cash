import type { NotificationEvent, NotificationPayload } from '@q2c/types';
import { format, strings } from '@q2c/ui';
import { formatDateTimeIL, formatMoney } from '@q2c/utils';

export interface PushContent {
  title: string;
  body: string;
  /** Where tapping the push takes the app (an expo-router path). */
  url: string;
}

const t = strings.notifications.push;
const q = strings.actionQueue;

/** Title, body and target screen of a push, in Hebrew. Parts the payload lacks are left out. */
export function pushContent(event: NotificationEvent, payload: NotificationPayload): PushContent {
  const customer = payload.customer_name ?? null;
  const quote = payload.quote_number
    ? format(q.quoteNumber, { number: payload.quote_number })
    : null;
  const invoice = payload.invoice_number
    ? format(q.invoiceNumber, { number: payload.invoice_number })
    : null;
  const when = payload.starts_at ? formatDateTimeIL(payload.starts_at) : null;
  const total = typeof payload.total_minor === 'number' ? formatMoney(payload.total_minor) : null;
  const amount =
    typeof payload.amount_minor === 'number' ? formatMoney(payload.amount_minor) : null;
  const quoteUrl = payload.quote_id ? `/quotes/${payload.quote_id}` : '/home';

  const body = (...parts: (string | null)[]) => parts.filter(Boolean).join(' · ');

  switch (event) {
    case 'quote_viewed':
    case 'quote_rejected':
      return { title: t[event], body: body(customer, quote), url: quoteUrl };
    case 'quote_approved':
      return { title: t[event], body: body(customer, quote, total), url: quoteUrl };
    case 'appointment_created':
    case 'appointment_reminder':
      return { title: t[event], body: body(customer, when), url: quoteUrl };
    case 'appointment_changed': {
      const cancelled = payload.status === 'cancelled' || payload.deleted === true;
      return {
        title: cancelled ? t.appointment_cancelled : t.appointment_changed,
        body: body(customer, when),
        url: quoteUrl,
      };
    }
    case 'invoice_issued':
      return { title: t[event], body: body(customer, invoice, total), url: '/home' };
    case 'payment_received':
      return { title: t[event], body: body(customer, invoice, amount), url: '/home' };
  }
}
