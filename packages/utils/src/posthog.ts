/** PostHog capture over HTTP (batch endpoint): https://posthog.com/docs/api/capture */

export const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';

/** The part of `fetch` used here (utils is built without DOM types). */
export type FetchLike = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean }>;

export interface CaptureEvent {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
}

/** Sends the events in one request; true when PostHog accepted them. */
export async function captureBatch(
  events: CaptureEvent[],
  options: { apiKey: string; host?: string; fetch?: FetchLike },
): Promise<boolean> {
  if (events.length === 0) return true;
  const host = (options.host || DEFAULT_POSTHOG_HOST).replace(/\/+$/, '');
  try {
    const doFetch = options.fetch ?? (globalThis as unknown as { fetch: FetchLike }).fetch;
    const response = await doFetch(`${host}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: options.apiKey,
        batch: events.map((e) => ({
          event: e.event,
          distinct_id: e.distinctId,
          properties: e.properties ?? {},
          timestamp: e.timestamp,
        })),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
