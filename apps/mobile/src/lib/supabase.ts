import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Database } from '@q2c/types';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { getConfig } from './config';

export type AppSupabaseClient = SupabaseClient<Database>;

let client: AppSupabaseClient | null = null;

/**
 * The app's Supabase client, created on first use so a missing configuration
 * surfaces as an error screen rather than a crash. The session is persisted in
 * AsyncStorage (localStorage on web), so it survives app restarts.
 */
export function getSupabase(): AppSupabaseClient {
  if (client) return client;
  const { supabaseUrl, supabaseAnonKey } = getConfig();
  const isServer = Platform.OS === 'web' && typeof window === 'undefined';
  client = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: isServer ? undefined : AsyncStorage,
      persistSession: !isServer,
      autoRefreshToken: !isServer,
      detectSessionInUrl: false,
    },
  });

  // Native apps refresh tokens only while in the foreground.
  if (Platform.OS !== 'web') {
    const supabase = client;
    AppState.addEventListener('change', (state) => {
      if (state === 'active') void supabase.auth.startAutoRefresh();
      else void supabase.auth.stopAutoRefresh();
    });
  }
  return client;
}
