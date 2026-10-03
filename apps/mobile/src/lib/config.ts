import Constants from 'expo-constants';

export interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export class ConfigError extends Error {}

/** Public connection settings injected by app.config.ts from the root .env. */
export function getConfig(): AppConfig {
  const extra = Constants.expoConfig?.extra ?? {};
  const supabaseUrl: unknown = extra.supabaseUrl;
  const supabaseAnonKey: unknown = extra.supabaseAnonKey;
  if (
    typeof supabaseUrl !== 'string' ||
    !supabaseUrl ||
    typeof supabaseAnonKey !== 'string' ||
    !supabaseAnonKey
  ) {
    throw new ConfigError('SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env');
  }
  return { supabaseUrl, supabaseAnonKey };
}
