// Critical paths 1 (the end: customer picks a date, an appointment exists) and 3
// (two customers pick the same slot, exactly one wins), through
// POST /public-quote/:token/schedule. PENDING: the scheduling stage (branch
// claude/project-thread-2hpt5m, migration *_quote_scheduling.sql) is not on
// main yet; this suite switches itself on once that migration is present.
// Contract as given by that stage: send body `slots: [{ startsAt, endsAt }]`
// (0 or 2-3), view `slots: [{ id, startsAt, endsAt, available }]` and
// `appointment: { slotId, startsAt, endsAt } | null`.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  adminClient,
  businesses,
  callFunction,
  createDraft,
  freshIp,
  repoRoot,
  sendQuote,
  signIn,
  users,
} from '../stack.ts';

const migrations = join(repoRoot, 'supabase/migrations');
const schedulingShipped =
  existsSync(migrations) &&
  readdirSync(migrations).some((f) => f.endsWith('_quote_scheduling.sql'));

/**
 * Each run books on its own days, so reruns on one database don't collide with
 * appointments booked by earlier runs.
 */
const runDayOffset = Math.floor(Math.random() * 20 * 365);

/** A 2-hour visit slot days out, at a random time of day. */
function slotTime(daysAhead: number) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + daysAhead + runDayOffset);
  start.setUTCHours(0, Math.floor(Math.random() * 264) * 5, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

/** Sends a quote of business A proposing these slots, approves it as the customer. */
async function approvedQuoteWithSlots(slots: { startsAt: string; endsAt: string }[]) {
  const owner = await signIn(users.ownerA.phone);
  const sent = await sendQuote(owner, await createDraft(owner, businesses.a), { slots });
  const ip = freshIp();
  const approved = await callFunction(`public-quote/${sent.token}/approve`, {
    body: { name: 'לקוח בדיקה' },
    headers: { 'X-Forwarded-For': ip },
  });
  expect(approved.status).toBe(200);
  const view = await callFunction(`public-quote/${sent.token}`, {
    headers: { 'X-Forwarded-For': ip },
  });
  const offered = (view.body!.slots ?? []) as {
    id: string;
    startsAt: string;
    available: boolean;
  }[];
  expect(offered).toHaveLength(slots.length);
  expect(offered.every((slot) => slot.available)).toBe(true);
  return { ...sent, ip, slots: offered };
}

const schedule = (token: string, slotId: string, ip: string) =>
  callFunction(`public-quote/${token}/schedule`, {
    body: { slotId },
    headers: { 'X-Forwarded-For': ip },
  });

describe.skipIf(!schedulingShipped)('scheduling (pending on the scheduling stage)', () => {
  it('the customer picks a date after approving, and a confirmed appointment exists', async () => {
    const quote = await approvedQuoteWithSlots([slotTime(20), slotTime(21)]);
    const res = await schedule(quote.token, quote.slots[1]!.id, quote.ip);
    expect(res.status).toBe(200);
    expect(res.body!.appointment).toMatchObject({ slotId: quote.slots[1]!.id });

    const { data } = await adminClient()
      .from('appointment')
      .select('status, starts_at')
      .eq('quote_id', quote.quoteId);
    expect(data).toHaveLength(1);
    expect(data![0]!.status).toBe('confirmed');
    expect(Date.parse(data![0]!.starts_at)).toBe(Date.parse(quote.slots[1]!.startsAt));

    // Booking the same slot again is harmless; a different one is refused.
    const again = await schedule(quote.token, quote.slots[1]!.id, quote.ip);
    expect(again.status).toBe(200);
    expect(again.body!.already).toBe(true);
    const other = await schedule(quote.token, quote.slots[0]!.id, quote.ip);
    expect(other.status).toBe(409);
    expect(other.body).toEqual({ error: 'already_scheduled' });
  });

  it('two customers pick the same slot at the same moment: exactly one wins', async () => {
    const time = slotTime(25);
    const [first, second] = await Promise.all([
      approvedQuoteWithSlots([time, slotTime(26)]),
      approvedQuoteWithSlots([time, slotTime(27)]),
    ]);
    const results = await Promise.all([
      schedule(first!.token, first!.slots[0]!.id, first!.ip),
      schedule(second!.token, second!.slots[0]!.id, second!.ip),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body).toEqual({ error: 'conflict' });

    const { data } = await adminClient()
      .from('appointment')
      .select('quote_id')
      .eq('status', 'confirmed')
      .eq('starts_at', time.startsAt);
    expect(data).toHaveLength(1);

    // The loser's page now shows that time as taken.
    const loser = results[0]!.status === 409 ? first! : second!;
    const view = await callFunction(`public-quote/${loser.token}`, {
      headers: { 'X-Forwarded-For': loser.ip },
    });
    const slots = view.body!.slots as { id: string; available: boolean }[];
    expect(slots.find((slot) => slot.id === loser.slots[0]!.id)!.available).toBe(false);
  });

  it('rejects scheduling before approval, an unknown slot, and another quote’s slot', async () => {
    const owner = await signIn(users.ownerA.phone);
    const unapproved = await sendQuote(owner, await createDraft(owner, businesses.a), {
      slots: [slotTime(30), slotTime(31)],
    });
    const ip = freshIp();
    const view = await callFunction(`public-quote/${unapproved.token}`, {
      headers: { 'X-Forwarded-For': ip },
    });
    const slotId = ((view.body!.slots ?? []) as { id: string }[])[0]!.id;
    const early = await schedule(unapproved.token, slotId, ip);
    expect([early.status, early.body]).toEqual([409, { error: 'quote_closed' }]);

    const approved = await approvedQuoteWithSlots([slotTime(32), slotTime(33)]);
    for (const foreign of [crypto.randomUUID(), slotId]) {
      const res = await schedule(approved.token, foreign, ip);
      expect([res.status, res.body]).toEqual([422, { error: 'validation_failed' }]);
    }
    const bad = await schedule(approved.token, 'not-a-uuid', ip);
    expect([bad.status, bad.body]).toEqual([422, { error: 'slot_required' }]);
  });
});
