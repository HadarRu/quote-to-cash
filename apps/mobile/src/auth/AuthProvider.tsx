import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BusinessTrade } from '@q2c/types';
import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { cache, ONBOARDING_SEEN_KEY } from '../lib/cache';
import { ConfigError } from '../lib/config';
import { isNetworkError } from '../lib/errors';
import { getSupabase } from '../lib/supabase';

export interface CurrentBusiness {
  id: string;
  name: string;
  logoPath: string | null;
  trade: BusinessTrade | null;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'error'; error: 'config' | 'network' | 'generic' }
  | { status: 'signedOut' }
  | { status: 'needsBusiness'; session: Session }
  | { status: 'ready'; session: Session; business: CurrentBusiness };

/** Result of loading the business of one user (one load per user / reload). */
type BusinessLoad =
  | { userId: string; reload: number; kind: 'none' }
  | { userId: string; reload: number; kind: 'found'; business: CurrentBusiness }
  | { userId: string; reload: number; kind: 'error'; error: 'network' | 'generic' };

interface AuthContextValue {
  state: AuthState;
  onboardingSeen: boolean;
  completeOnboarding: () => Promise<void>;
  /** Reloads the current business (after setup, or to retry after an error). */
  refreshBusiness: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const businessCacheKey = (userId: string) => `business:${userId}`;

function configStatus(): 'ok' | 'config' | 'generic' {
  try {
    getSupabase();
    return 'ok';
  } catch (error) {
    return error instanceof ConfigError ? 'config' : 'generic';
  }
}

async function loadBusiness(userId: string, reload: number): Promise<BusinessLoad> {
  const { data, error } = await getSupabase()
    .from('business')
    .select('id, name, logo_path, trade')
    .is('deleted_at', null)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (error) {
    // Offline start: fall back to the last known business.
    const cached = await cache.get<CurrentBusiness>(businessCacheKey(userId));
    return cached
      ? { userId, reload, kind: 'found', business: cached }
      : { userId, reload, kind: 'error', error: isNetworkError(error) ? 'network' : 'generic' };
  }
  if (!data) return { userId, reload, kind: 'none' };
  const business = { id: data.id, name: data.name, logoPath: data.logo_path, trade: data.trade };
  await cache.set(businessCacheKey(userId), business);
  return { userId, reload, kind: 'found', business };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [config] = useState(configStatus);
  // undefined = not restored yet; null = signed out.
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [onboardingSeen, setOnboardingSeen] = useState<boolean | undefined>(undefined);
  const [reload, setReload] = useState(0);
  const [business, setBusiness] = useState<BusinessLoad | null>(null);

  // Restore the saved session and follow sign-in / sign-out / token refresh.
  useEffect(() => {
    if (config !== 'ok') return;
    const supabase = getSupabase();
    AsyncStorage.getItem(ONBOARDING_SEEN_KEY)
      .then((value) => setOnboardingSeen(value === '1'))
      .catch(() => setOnboardingSeen(false));
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [config]);

  const userId = session?.user.id;

  // Load the user's business when the user changes or a reload is requested.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void loadBusiness(userId, reload).then((result) => {
      if (!cancelled) setBusiness(result);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, reload]);

  const state = useMemo<AuthState>(() => {
    if (config !== 'ok') return { status: 'error', error: config };
    if (session === undefined || onboardingSeen === undefined) return { status: 'loading' };
    if (session === null) return { status: 'signedOut' };
    if (!business || business.userId !== session.user.id || business.reload !== reload)
      return { status: 'loading' };
    if (business.kind === 'error') return { status: 'error', error: business.error };
    if (business.kind === 'none') return { status: 'needsBusiness', session };
    return { status: 'ready', session, business: business.business };
  }, [config, session, onboardingSeen, business, reload]);

  const completeOnboarding = useCallback(async () => {
    setOnboardingSeen(true);
    await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, '1').catch(() => undefined);
  }, []);

  const refreshBusiness = useCallback(() => setReload((n) => n + 1), []);

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    const { error } = await supabase.auth.signOut();
    // Offline: the server-side revoke failed, but the device must still forget the session.
    if (error) await supabase.auth.signOut({ scope: 'local' });
    await cache.clear();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      onboardingSeen: onboardingSeen ?? false,
      completeOnboarding,
      refreshBusiness,
      signOut,
    }),
    [state, onboardingSeen, completeOnboarding, refreshBusiness, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** Session and business of a signed-in user with a business (screens inside the (app) group). */
export function useCurrentBusiness() {
  const { state } = useAuth();
  if (state.status !== 'ready') throw new Error('useCurrentBusiness requires a ready session');
  return state;
}
