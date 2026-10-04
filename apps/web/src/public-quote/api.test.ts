import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleVisit } from './api';

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scheduleVisit', () => {
  it('posts the chosen slot to the schedule endpoint', async () => {
    const fetchMock = respond(200, { state: 'approved' });
    expect(await scheduleVisit('tok', 'slot-1')).toEqual({
      kind: 'ok',
      data: { state: 'approved' },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/functions\/v1\/public-quote\/tok\/schedule$/);
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ slotId: 'slot-1' }) });
  });

  it('tells a taken time apart from a closed quote', async () => {
    respond(409, { error: 'conflict' });
    expect(await scheduleVisit('tok', 'slot-1')).toEqual({ kind: 'conflict' });
    vi.restoreAllMocks();
    respond(409, { error: 'already_scheduled' });
    expect(await scheduleVisit('tok', 'slot-1')).toEqual({ kind: 'closed' });
  });
});
