import type { NotificationEvent, NotificationPayload } from '@q2c/types';
import type { CaptureEvent } from '@q2c/utils';
import {
  isRetryable,
  ticketError,
  type ExpoMessage,
  type ExpoTicket,
} from '../_shared/expo-push.ts';
import { json } from '../_shared/http.ts';
import { pushContent } from './content.ts';

/** A queued push as claim_push_notifications returns it. */
export interface PushJob {
  id: string;
  business_id: string;
  recipient_user_id: string;
  event: NotificationEvent;
  payload: NotificationPayload;
  attempts: number;
  /** The recipient's push tokens, most recently seen first. */
  tokens: string[];
}

/** Input of complete_push_notifications. */
export interface PushResult {
  id: string;
  ok: boolean;
  retry: boolean;
  error: string | null;
  invalid_tokens: string[];
}

export interface AnalyticsRow {
  id: number;
  event: string;
  distinct_id: string;
  business_id: string;
  properties: Record<string, unknown>;
  created_at: string;
}

type DbError = { code?: string; message: string };
type DbResult<T> = { data: T | null; error: DbError | null };

export interface Deps {
  /** Shared with the database (Vault `notify_secret`); callers send it as x-notify-secret. */
  notifySecret: string;
  enqueueReminders(now: Date): Promise<DbResult<number>>;
  claimPushes(limit: number): Promise<DbResult<PushJob[]>>;
  completePushes(results: PushResult[]): Promise<{ error: DbError | null }>;
  sendPush(messages: ExpoMessage[]): Promise<ExpoTicket[]>;
  claimAnalytics(limit: number): Promise<DbResult<AnalyticsRow[]>>;
  markAnalyticsSent(ids: number[]): Promise<{ error: DbError | null }>;
  /** Sends events to PostHog; null when POSTHOG_KEY is not set (events wait in the outbox). */
  capture: ((events: CaptureEvent[]) => Promise<boolean>) | null;
  now?: () => Date;
}

export const PUSH_BATCH = 100;
/** Batches per run; the rest waits for the next run (every minute). */
export const MAX_PUSH_BATCHES = 10;
export const ANALYTICS_BATCH = 500;

export interface RunSummary {
  reminders: number;
  sent: number;
  retried: number;
  failed: number;
  analytics: number;
}

/** Equal-length strings compared without an early exit. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * POST /notify (header x-notify-secret) -> RunSummary
 *
 * Called by the database (pg_net right after a push is queued, pg_cron every
 * minute). Queues tomorrow's appointment reminders, sends queued pushes
 * through Expo and records each outcome, then forwards analytics events to
 * PostHog. Safe to run concurrently: claims skip rows another run holds.
 */
export async function handleNotify(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!deps.notifySecret) {
    console.error('notify: NOTIFY_SECRET must be set');
    return json(500, { error: 'internal_error' });
  }
  if (!sameSecret(req.headers.get('x-notify-secret') ?? '', deps.notifySecret))
    return json(401, { error: 'not_authenticated' });

  try {
    return json(200, await runNotify(deps));
  } catch (error) {
    console.error('notify failed', error);
    return json(500, { error: 'internal_error' });
  }
}

export async function runNotify(deps: Deps): Promise<RunSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const summary: RunSummary = { reminders: 0, sent: 0, retried: 0, failed: 0, analytics: 0 };

  const reminders = await deps.enqueueReminders(now);
  if (reminders.error) console.error('notify: reminders failed', reminders.error);
  summary.reminders = reminders.data ?? 0;

  for (let batch = 0; batch < MAX_PUSH_BATCHES; batch++) {
    const claimed = await deps.claimPushes(PUSH_BATCH);
    if (claimed.error) throw new Error(`claim_push_notifications: ${claimed.error.message}`);
    const jobs = claimed.data ?? [];
    if (jobs.length === 0) break;

    const results = await deliver(jobs, deps.sendPush);
    const completed = await deps.completePushes(results);
    if (completed.error) throw new Error(`complete_push_notifications: ${completed.error.message}`);
    for (const r of results) {
      if (r.ok) summary.sent++;
      else if (r.retry) summary.retried++;
      else summary.failed++;
    }
    if (jobs.length < PUSH_BATCH) break;
  }

  summary.analytics = await flushAnalytics(deps);
  return summary;
}

/** Sends one message per token and folds the tickets back into one result per push. */
export async function deliver(jobs: PushJob[], sendPush: Deps['sendPush']): Promise<PushResult[]> {
  const messages: ExpoMessage[] = [];
  const owners: number[] = [];
  jobs.forEach((job, index) => {
    const content = pushContent(job.event, job.payload);
    for (const token of job.tokens) {
      messages.push({
        to: token,
        title: content.title,
        body: content.body,
        data: { event: job.event, url: content.url, notificationId: job.id },
        sound: 'default',
        priority: 'high',
        channelId: 'default',
      });
      owners.push(index);
    }
  });

  const tickets = messages.length ? await sendPush(messages) : [];
  const perJob = jobs.map(() => [] as { token: string; ticket: ExpoTicket }[]);
  tickets.forEach((ticket, i) => perJob[owners[i]!]!.push({ token: messages[i]!.to, ticket }));

  return jobs.map((job, index) => {
    if (job.tokens.length === 0)
      return { id: job.id, ok: false, retry: false, error: 'no_device', invalid_tokens: [] };
    const sent = perJob[index]!;
    const invalid = sent
      .filter((s) => ticketError(s.ticket) === 'DeviceNotRegistered')
      .map((s) => s.token);
    if (sent.some((s) => s.ticket.status === 'ok'))
      return { id: job.id, ok: true, retry: false, error: null, invalid_tokens: invalid };
    return {
      id: job.id,
      ok: false,
      retry: sent.some((s) => isRetryable(s.ticket)),
      error: sent.map((s) => ticketError(s.ticket)).find(Boolean) ?? 'unknown',
      invalid_tokens: invalid,
    };
  });
}

/** Forwards pending analytics events to PostHog; returns how many were accepted. */
export async function flushAnalytics(deps: Deps): Promise<number> {
  if (!deps.capture) return 0;
  const claimed = await deps.claimAnalytics(ANALYTICS_BATCH);
  if (claimed.error) {
    console.error('notify: claim_analytics_events failed', claimed.error);
    return 0;
  }
  const rows = claimed.data ?? [];
  if (rows.length === 0) return 0;
  const accepted = await deps.capture(
    rows.map((row) => ({
      event: row.event,
      distinctId: row.distinct_id,
      timestamp: row.created_at,
      properties: {
        ...row.properties,
        business_id: row.business_id,
        source: 'server',
        $groups: { business: row.business_id },
      },
    })),
  );
  if (!accepted) return 0;
  const marked = await deps.markAnalyticsSent(rows.map((r) => r.id));
  if (marked.error) console.error('notify: mark_analytics_sent failed', marked.error);
  return rows.length;
}
