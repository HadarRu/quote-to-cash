/** Expo Push Service client: https://docs.expo.dev/push-notifications/sending-notifications/ */

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts at most 100 messages per request. */
const CHUNK = 100;

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
}

export type ExpoTicket =
  { status: 'ok'; id: string } | { status: 'error'; message: string; details?: { error?: string } };

/** Ticket errors worth another attempt later; anything else is final. */
const RETRYABLE = new Set(['MessageRateExceeded', 'NetworkError', 'HTTPError']);

export function isRetryable(ticket: ExpoTicket): boolean {
  return ticket.status === 'error' && RETRYABLE.has(ticket.details?.error ?? '');
}

export function ticketError(ticket: ExpoTicket): string | null {
  if (ticket.status === 'ok') return null;
  return ticket.details?.error ?? ticket.message;
}

function failedChunk(length: number, error: string, message: string): ExpoTicket[] {
  return Array.from({ length }, () => ({ status: 'error' as const, message, details: { error } }));
}

/**
 * Sends the messages and returns one ticket per message, in order. Transport
 * failures (no connection, 5xx, 429) become retryable error tickets, so the
 * caller never has to tell a lost request from a rejected message.
 */
export async function sendExpoPush(
  messages: ExpoMessage[],
  options: { accessToken?: string; fetch?: typeof fetch } = {},
): Promise<ExpoTicket[]> {
  const doFetch = options.fetch ?? fetch;
  const tickets: ExpoTicket[] = [];
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;
    try {
      const response = await doFetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(chunk),
      });
      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429;
        tickets.push(
          ...failedChunk(
            chunk.length,
            retryable ? 'HTTPError' : `HTTP${response.status}`,
            `Expo push returned ${response.status}`,
          ),
        );
        continue;
      }
      const body = (await response.json()) as { data?: ExpoTicket[] };
      const data = Array.isArray(body.data) ? body.data : [];
      tickets.push(
        ...chunk.map(
          (_, j) =>
            data[j] ?? {
              status: 'error' as const,
              message: 'missing ticket',
              details: { error: 'HTTPError' },
            },
        ),
      );
    } catch (error) {
      tickets.push(
        ...failedChunk(
          chunk.length,
          'NetworkError',
          error instanceof Error ? error.message : 'network error',
        ),
      );
    }
  }
  return tickets;
}
