import { describe, expect, it } from 'vitest';
import { Constants } from './database.types.ts';
import {
  ACTION_QUEUE_KINDS,
  NOTIFICATION_EVENTS,
  NOTIFICATION_GROUPS,
  RegisterDeviceRequestSchema,
} from './notification.ts';

const businessId = '6f9619ff-8b86-4d11-b42d-00c04fc964ff';

describe('RegisterDeviceRequestSchema', () => {
  it('accepts Expo push tokens from both token formats', () => {
    for (const token of ['ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]', 'ExpoPushToken[a-b_c]']) {
      expect(
        RegisterDeviceRequestSchema.safeParse({ businessId, token, platform: 'android' }).success,
      ).toBe(true);
    }
  });

  it('rejects anything else with push_token_invalid', () => {
    const result = RegisterDeviceRequestSchema.safeParse({
      businessId,
      token: 'fcm:abc',
      platform: 'ios',
    });
    expect(result.error?.issues.map((i) => i.message)).toEqual(['push_token_invalid']);
  });
});

describe('notification events', () => {
  it('match the database enum and every event is in exactly one group', () => {
    expect([...NOTIFICATION_EVENTS].sort()).toEqual(
      [...Constants.public.Enums.notification_event].sort(),
    );
    expect(Object.values(NOTIFICATION_GROUPS).flat().sort()).toEqual(
      [...NOTIFICATION_EVENTS].sort(),
    );
    expect(ACTION_QUEUE_KINDS).toHaveLength(5);
  });
});
