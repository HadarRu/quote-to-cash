import type { AnalyticsEvent } from '@q2c/types';
import { captureBatch, type CaptureEvent } from '@q2c/utils';

export interface AnalyticsConfig {
  /** PostHog project key (public by design); empty turns analytics off. */
  apiKey: string;
  host?: string;
}

/**
 * Client-side PostHog events. Only what happens on the phone is sent from
 * here (app_opened); quote, appointment, job, invoice and payment events are
 * recorded by the database and forwarded by the `notify` function, so each is
 * counted once whichever screen or customer caused it.
 */
export function createAnalytics(
  config: AnalyticsConfig,
  send: (events: CaptureEvent[]) => Promise<boolean> = (events) =>
    captureBatch(events, { apiKey: config.apiKey, host: config.host }),
) {
  return {
    enabled: Boolean(config.apiKey),
    async track(
      event: AnalyticsEvent,
      distinctId: string,
      properties: Record<string, unknown> = {},
    ): Promise<boolean> {
      if (!config.apiKey) return false;
      return send([
        {
          event,
          distinctId,
          timestamp: new Date().toISOString(),
          properties: { ...properties, source: 'app' },
        },
      ]);
    },
  };
}

export type Analytics = ReturnType<typeof createAnalytics>;
