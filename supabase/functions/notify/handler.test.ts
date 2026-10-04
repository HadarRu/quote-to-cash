import type { NotificationEvent } from '@q2c/types';
import { describe, expect, it, vi } from 'vitest';
import type { ExpoMessage, ExpoTicket } from '../_shared/expo-push.ts';
import { pushContent } from './content.ts';
import {
  deliver,
  handleNotify,
  MAX_PUSH_BATCHES,
  PUSH_BATCH,
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

  it('a push Expo returned no ticket for fails as unknown', async () => {
    const results = await deliver([job('quote_viewed', { quote_id: QUOTE })], async () => []);
    expect(results[0]).toMatchObject({
      ok: false,
      retry: false,
      error: 'unknown',
      invalid_tokens: [],
    });
  });

  it('a ticket error without details is reported by its message', async () => {
    const results = await deliver([job('quote_viewed', { quote_id: QUOTE })], async (messages) =>
      messages.map(() => ({ status: 'error', message: 'InvalidCredentials' })),
    );
    expect(results[0]).toMatchObject({ ok: false, retry: false, error: 'InvalidCredentials' });
  });

  it('a failure to claim pushes is a 500 and nothing is sent', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps, sent } = fakeDeps([job('quote_viewed', { quote_id: QUOTE })]);
    deps.claimPushes = async () => ({ data: null, error: { message: 'locked' } });
    const response = await handleNotify(post(), deps);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error' });
    expect(sent).toHaveLength(0);
    expect(consoleError).toHaveBeenCalledWith(
      'notify failed',
      new Error('claim_push_notifications: locked'),
    );
    consoleError.mockRestore();
  });

  it('keeps claiming full batches, up to the per-run limit', async () => {
    const queue = Array.from({ length: PUSH_BATCH + 1 }, () =>
      job('quote_viewed', { quote_id: QUOTE }),
    );
    const { deps } = fakeDeps(queue);
    const response = await handleNotify(post(), deps);
    expect(await response.json()).toMatchObject({ sent: PUSH_BATCH + 1 });
    expect(deps.claimPushes).toHaveBeenCalledTimes(2);

    const backlog = Array.from({ length: MAX_PUSH_BATCHES * PUSH_BATCH + 5 }, () =>
      job('quote_viewed', { quote_id: QUOTE }),
    );
    const capped = fakeDeps(backlog);
    const summary = await (await handleNotify(post(), capped.deps)).json();
    expect(summary).toMatchObject({ sent: MAX_PUSH_BATCHES * PUSH_BATCH });
    expect(capped.deps.claimPushes).toHaveBeenCalledTimes(MAX_PUSH_BATCHES);
    expect(backlog).toHaveLength(5);
  });

  it('a claim with no rows ends the run', async () => {
    const { deps } = fakeDeps([]);
    deps.claimPushes = vi.fn(async () => ({ data: null, error: null }));
    expect(await (await handleNotify(post(), deps)).json()).toEqual({
      reminders: 0,
      sent: 0,
      retried: 0,
      failed: 0,
      analytics: 1,
    });
    expect(deps.completePushes).not.toHaveBeenCalled();
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
  it('keeps going when claiming or marking analytics fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const claimFails = fakeDeps([]);
    claimFails.deps.claimAnalytics = async () => ({ data: null, error: { message: 'boom' } });
    const response = await handleNotify(post(), claimFails.deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ analytics: 0 });
    expect(claimFails.deps.capture).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('notify: claim_analytics_events failed', {
      message: 'boom',
    });

    const markFails = fakeDeps([]);
    markFails.deps.markAnalyticsSent = async () => ({ error: { message: 'boom' } });
    expect(await (await handleNotify(post(), markFails.deps)).json()).toMatchObject({
      analytics: 1,
    });
    expect(consoleError).toHaveBeenCalledWith('notify: mark_analytics_sent failed', {
      message: 'boom',
    });
    consoleError.mockRestore();
  });

  it('does not call PostHog when the outbox is empty', async () => {
    const { deps } = fakeDeps([]);
    deps.claimAnalytics = vi.fn(async () => ({ data: null, error: null }));
    expect(await (await handleNotify(post(), deps)).json()).toMatchObject({ analytics: 0 });
    expect(deps.capture).not.toHaveBeenCalled();
    expect(deps.markAnalyticsSent).not.toHaveBeenCalled();
  });
});

describe('reminders', () => {
  it('queues reminders on every run, at the run time', async () => {
    const { deps } = fakeDeps([]);
    await handleNotify(post(), deps);
    expect(deps.enqueueReminders).toHaveBeenCalledWith(new Date('2026-10-04T16:00:00Z'));
  });

  it('reports how many reminders were queued', async () => {
    const { deps } = fakeDeps([]);
    deps.enqueueReminders = vi.fn(async () => ({ data: 3, error: null }));
    expect(await (await handleNotify(post(), deps)).json()).toMatchObject({ reminders: 3 });
  });

  it('a reminders failure is logged and the pushes still go out', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps, sent } = fakeDeps([job('quote_viewed', { quote_id: QUOTE })]);
    deps.enqueueReminders = vi.fn(async () => ({ data: null, error: { message: 'boom' } }));
    const response = await handleNotify(post(), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reminders: 0, sent: 1 });
    expect(sent).toHaveLength(1);
    expect(consoleError).toHaveBeenCalledWith('notify: reminders failed', { message: 'boom' });
    consoleError.mockRestore();
  });

  it('uses the current time when no clock is given', async () => {
    const { deps } = fakeDeps([]);
    delete deps.now;
    const before = Date.now();
    await handleNotify(post(), deps);
    const at = vi.mocked(deps.enqueueReminders).mock.calls[0]![0];
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
    expect(at.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
