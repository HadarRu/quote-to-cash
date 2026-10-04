import type { NotificationEvent } from '@q2c/types';
import { describe, expect, it, vi } from 'vitest';
import type { ExpoMessage, ExpoTicket } from '../_shared/expo-push.ts';
import { pushContent } from './content.ts';
import {
  deliver,
  handleNotify,
  type AnalyticsRow,
  type Deps,
  type PushJob,
  type PushResult,
} from './handler.ts';

const SECRET = 'test-notify-secret';
const BUSINESS = '10000000-0000-4000-a000-000000000001';
const QUOTE = '80000000-0000-4000-a000-000000000001';
const OWNER = '00000000-0000-4000-a000-000000000001';
const TOKEN = 'ExponentPushToken[owner]';

let nextId = 0;
function job(event: NotificationEvent, payload: PushJob['payload'], tokens = [TOKEN]): PushJob {
  nextId++;
  return {
    id: `90000000-0000-4000-a000-${String(nextId).padStart(12, '0')}`,
    business_id: BUSINESS,
    recipient_user_id: OWNER,
    event,
    payload,
    attempts: 1,
    tokens,
  };
}

const ok = (): ExpoTicket => ({ status: 'ok', id: 'ticket' });
const error = (code: string): ExpoTicket => ({
  status: 'error',
  message: code,
  details: { error: code },
});

/** Test double for the database queue and Expo: records what was sent and completed. */
function fakeDeps(queue: PushJob[], send: (m: ExpoMessage) => ExpoTicket = ok) {
  const sent: ExpoMessage[] = [];
  const completed: PushResult[] = [];
  const analytics: AnalyticsRow[] = [
    {
      id: 1,
      event: 'quote_approved',
      distinct_id: BUSINESS,
      business_id: BUSINESS,
      properties: { quote_id: QUOTE },
      created_at: '2026-10-04T10:00:00Z',
    },
  ];
  const marked: number[] = [];
  const captured: unknown[] = [];
  const deps: Deps = {
    notifySecret: SECRET,
    enqueueReminders: vi.fn(async () => ({ data: 0, error: null })),
    claimPushes: vi.fn(async (limit: number) => ({ data: queue.splice(0, limit), error: null })),
    completePushes: vi.fn(async (results: PushResult[]) => {
      completed.push(...results);
      return { error: null };
    }),
    sendPush: vi.fn(async (messages: ExpoMessage[]) => {
      sent.push(...messages);
      return messages.map(send);
    }),
    claimAnalytics: vi.fn(async () => ({
      data: analytics.filter((a) => !marked.includes(a.id)),
      error: null,
    })),
    markAnalyticsSent: vi.fn(async (ids: number[]) => {
      marked.push(...ids);
      return { error: null };
    }),
    capture: vi.fn(async (events) => {
      captured.push(...events);
      return true;
    }),
    now: () => new Date('2026-10-04T16:00:00Z'),
  };
  return { deps, sent, completed, marked, captured };
}

const post = (secret: string | null = SECRET, method = 'POST') =>
  new Request('http://localhost/notify', {
    method,
    headers: secret === null ? {} : { 'x-notify-secret': secret },
    body: method === 'POST' ? '{}' : undefined,
  });

describe('handleNotify: access', () => {
  it('requires the shared secret', async () => {
    const { deps } = fakeDeps([]);
    expect((await handleNotify(post(null), deps)).status).toBe(401);
    expect((await handleNotify(post('wrong-secret-value'), deps)).status).toBe(401);
    expect((await handleNotify(post(SECRET, 'GET'), deps)).status).toBe(405);
    expect(deps.claimPushes).not.toHaveBeenCalled();
  });

  it('refuses to run without a configured secret', async () => {
    const { deps } = fakeDeps([]);
    expect((await handleNotify(post(), { ...deps, notifySecret: '' })).status).toBe(500);
  });
});

describe('each event produces the expected push', () => {
  const cases: [NotificationEvent, PushJob['payload'], string, string, string][] = [
    [
      'quote_viewed',
      { quote_id: QUOTE, quote_number: 12, customer_name: 'משה' },
      'ההצעה נפתחה',
      'משה · הצעה מס׳ 12',
      `/quotes/${QUOTE}`,
    ],
    [
      'quote_approved',
      { quote_id: QUOTE, quote_number: 12, customer_name: 'משה', total_minor: 59000 },
      'ההצעה אושרה',
      'משה · הצעה מס׳ 12 · ',
      `/quotes/${QUOTE}`,
    ],
    [
      'quote_rejected',
      { quote_id: QUOTE, quote_number: 12, customer_name: 'משה' },
      'ההצעה נדחתה',
      'משה · הצעה מס׳ 12',
      `/quotes/${QUOTE}`,
    ],
    [
      'appointment_created',
      { quote_id: QUOTE, customer_name: 'משה', starts_at: '2026-10-05T07:00:00Z' },
      'נקבע מועד חדש',
      'משה · 05.10.2026',
      `/quotes/${QUOTE}`,
    ],
    [
      'appointment_changed',
      {
        quote_id: QUOTE,
        customer_name: 'משה',
        starts_at: '2026-10-05T07:00:00Z',
        status: 'confirmed',
      },
      'מועד עודכן',
      'משה · 05.10.2026',
      `/quotes/${QUOTE}`,
    ],
    [
      'appointment_reminder',
      { quote_id: null, customer_name: 'משה', starts_at: '2026-10-05T07:00:00Z' },
      'תזכורת: מועד מחר',
      'משה · 05.10.2026',
      '/home',
    ],
    [
      'invoice_issued',
      { invoice_id: 'i', invoice_number: 7, customer_name: 'משה', total_minor: 118000 },
      'חשבונית הופקה',
      'משה · חשבונית מס׳ 7 · ',
      '/home',
    ],
    [
      'payment_received',
      { invoice_id: 'i', invoice_number: 7, customer_name: 'משה', amount_minor: 18000 },
      'התקבל תשלום',
      'משה · חשבונית מס׳ 7 · ',
      '/home',
    ],
  ];

  it.each(cases)('%s', async (event, payload, title, bodyStart, url) => {
    const queued = job(event, payload);
    const { deps, sent, completed } = fakeDeps([queued]);
    const response = await handleNotify(post(), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sent: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: TOKEN,
      title,
      data: { event, url, notificationId: queued.id },
    });
    expect(sent[0]!.body.startsWith(bodyStart)).toBe(true);
    expect(completed).toEqual([
      { id: queued.id, ok: true, retry: false, error: null, invalid_tokens: [] },
    ]);
  });

  it('says so when an appointment is cancelled', () => {
    expect(
      pushContent('appointment_changed', { status: 'cancelled', customer_name: 'משה' }).title,
    ).toBe('מועד בוטל');
  });

  it('leaves out what the payload lacks', () => {
    expect(pushContent('quote_viewed', { quote_id: QUOTE }).body).toBe('');
  });

  it('pushes to every device of the recipient', async () => {
    const { deps, sent, completed } = fakeDeps([
      job('quote_approved', { quote_id: QUOTE }, [TOKEN, 'ExponentPushToken[tablet]']),
    ]);
    await handleNotify(post(), deps);
    expect(sent.map((m) => m.to)).toEqual([TOKEN, 'ExponentPushToken[tablet]']);
    expect(completed[0]!.ok).toBe(true);
  });
});

describe('push failure fallback', () => {
  it('a recipient without a device fails at once (the push stays visible in the queue)', async () => {
    const queued = job('quote_approved', { quote_id: QUOTE }, []);
    const { deps, sent, completed } = fakeDeps([queued]);
    await handleNotify(post(), deps);
    expect(sent).toHaveLength(0);
    expect(completed).toEqual([
      { id: queued.id, ok: false, retry: false, error: 'no_device', invalid_tokens: [] },
    ]);
  });

  it('a token Expo no longer knows fails the push and is reported for removal', async () => {
    const queued = job('invoice_issued', { invoice_id: 'i' });
    const { deps, completed } = fakeDeps([queued], () => error('DeviceNotRegistered'));
    const response = await handleNotify(post(), deps);
    expect(await response.json()).toMatchObject({ sent: 0, failed: 1 });
    expect(completed).toEqual([
      {
        id: queued.id,
        ok: false,
        retry: false,
        error: 'DeviceNotRegistered',
        invalid_tokens: [TOKEN],
      },
    ]);
  });

  it('rate limits and lost requests are retried', async () => {
    for (const code of ['MessageRateExceeded', 'NetworkError', 'HTTPError']) {
      const { deps, completed } = fakeDeps([job('quote_viewed', { quote_id: QUOTE })], () =>
        error(code),
      );
      await handleNotify(post(), deps);
      expect(completed[0]).toMatchObject({ ok: false, retry: true, error: code });
    }
  });

  it('one working device is enough; the dead one is still removed', async () => {
    const results = await deliver(
      [job('quote_viewed', { quote_id: QUOTE }, ['ExponentPushToken[old]', TOKEN])],
      async (messages) =>
        messages.map((m) => (m.to === TOKEN ? ok() : error('DeviceNotRegistered'))),
    );
    expect(results[0]).toMatchObject({ ok: true, invalid_tokens: ['ExponentPushToken[old]'] });
  });

  it('a database failure is a 500 so the next run tries again', async () => {
    const { deps } = fakeDeps([job('quote_viewed', { quote_id: QUOTE })]);
    deps.completePushes = async () => ({ error: { message: 'boom' } });
    expect((await handleNotify(post(), deps)).status).toBe(500);
  });
});

describe('analytics forwarding', () => {
  it('sends outbox events to PostHog with the business as a group, then marks them sent', async () => {
    const { deps, captured, marked } = fakeDeps([]);
    const response = await handleNotify(post(), deps);
    expect(await response.json()).toMatchObject({ analytics: 1 });
    expect(captured).toEqual([
      {
        event: 'quote_approved',
        distinctId: BUSINESS,
        timestamp: '2026-10-04T10:00:00Z',
        properties: {
          quote_id: QUOTE,
          business_id: BUSINESS,
          source: 'server',
          $groups: { business: BUSINESS },
        },
      },
    ]);
    expect(marked).toEqual([1]);
  });

  it('keeps events in the outbox when PostHog refuses them or is not configured', async () => {
    const refused = fakeDeps([]);
    refused.deps.capture = async () => false;
    await handleNotify(post(), refused.deps);
    expect(refused.marked).toEqual([]);

    const off = fakeDeps([]);
    off.deps.capture = null;
    await handleNotify(post(), off.deps);
    expect(off.deps.claimAnalytics).not.toHaveBeenCalled();
  });
});

describe('reminders', () => {
  it('queues reminders on every run, at the run time', async () => {
    const { deps } = fakeDeps([]);
    await handleNotify(post(), deps);
    expect(deps.enqueueReminders).toHaveBeenCalledWith(new Date('2026-10-04T16:00:00Z'));
  });
});
