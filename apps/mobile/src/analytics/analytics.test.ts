import { describe, expect, it, vi } from 'vitest';
import { createAnalytics } from './analytics.ts';

describe('createAnalytics', () => {
  it('sends app_opened with the user, business and platform', async () => {
    const send = vi.fn(async () => true);
    const analytics = createAnalytics({ apiKey: 'phc_test' }, send);
    expect(
      await analytics.track('app_opened', 'user-1', {
        business_id: 'b-1',
        platform: 'ios',
        $groups: { business: 'b-1' },
      }),
    ).toBe(true);
    expect(send).toHaveBeenCalledWith([
      expect.objectContaining({
        event: 'app_opened',
        distinctId: 'user-1',
        properties: {
          business_id: 'b-1',
          platform: 'ios',
          $groups: { business: 'b-1' },
          source: 'app',
        },
      }),
    ]);
  });

  it('does nothing without a key', async () => {
    const send = vi.fn(async () => true);
    const analytics = createAnalytics({ apiKey: '' }, send);
    expect(analytics.enabled).toBe(false);
    expect(await analytics.track('app_opened', 'user-1')).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
