import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'q2c:cache:';

/** Small JSON cache for offline reads. Failures are ignored: the cache is best-effort. */
export const cache = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await AsyncStorage.getItem(PREFIX + key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    try {
      await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // Ignore: a full or unavailable storage only means no offline copy.
    }
  },
  async clear(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(PREFIX)));
    } catch {
      // Ignore.
    }
  },
};

/** Flags that live outside the cache (not cleared on sign-out). */
export const ONBOARDING_SEEN_KEY = 'q2c:onboarding-seen';
