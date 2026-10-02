import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { supabase } from './supabase';

/**
 * Which side of Mello this phone is.
 * - Parent: a Supabase Auth account (email + password); the API gets its access token per request.
 * - Kid: a device token from pairing, kept in the Keystore/Keychain.
 * - Self: a Supabase account coaching their own phone. It also holds a device token for its own
 *   subject, so the gate, rules and sessions reuse the kid plumbing.
 */
export type Session =
  | { role: 'parent'; userId: string; email: string }
  | { role: 'kid'; token: string; kidId: string; kidName: string }
  | { role: 'self'; userId: string; token: string; subjectId: string; name: string };
type DeviceSession = Extract<Session, { role: 'kid' | 'self' }>;

const KID_KEY = 'mello.session';
/** Set when someone chose "Just me" but hasn't finished setting it up (they sign in as a Supabase user first). */
const INTENT_KEY = 'mello.intent';
export type Intent = 'self' | null;

type Ctx = {
  session: Session | null;
  loading: boolean;
  signInKid: (s: Extract<Session, { role: 'kid' }>) => Promise<void>;
  signInSelf: (s: Extract<Session, { role: 'self' }>) => Promise<void>;
  intent: Intent;
  setIntent: (i: Intent) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [device, setDevice] = useState<DeviceSession | null>(null);
  const [parent, setParent] = useState<Extract<Session, { role: 'parent' }> | null>(null);
  const [loading, setLoading] = useState(true);
  const [intent, setIntentState] = useState<Intent>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      SecureStore.getItemAsync(KID_KEY).catch(() => null),
      supabase.auth.getSession().then(({ data }) => data.session),
      SecureStore.getItemAsync(INTENT_KEY).catch(() => null),
    ])
      .then(([raw, s, savedIntent]) => {
        if (!mounted) return;
        setIntentState(savedIntent === 'self' ? 'self' : null);
        const stored = raw ? JSON.parse(raw) : null;
        // Sessions saved before Supabase auth may still hold an old parent token; drop those.
        // A self session needs its Supabase sign-in too; without it, start over.
        setDevice(stored?.role === 'kid' || (stored?.role === 'self' && s?.user.id === stored.userId) ? stored : null);
        setParent(s ? { role: 'parent', userId: s.user.id, email: s.user.email ?? '' } : null);
      })
      .finally(() => mounted && setLoading(false));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setParent(s ? { role: 'parent', userId: s.user.id, email: s.user.email ?? '' } : null);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const setIntent = useCallback(async (i: Intent) => {
    if (i) await SecureStore.setItemAsync(INTENT_KEY, i);
    else await SecureStore.deleteItemAsync(INTENT_KEY);
    setIntentState(i);
  }, []);

  const signInDevice = useCallback(
    async (s: DeviceSession) => {
      await SecureStore.setItemAsync(KID_KEY, JSON.stringify(s));
      setDevice(s);
      await setIntent(null);
    },
    [setIntent],
  );

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(KID_KEY);
    await SecureStore.deleteItemAsync(INTENT_KEY);
    setDevice(null);
    setIntentState(null);
    await supabase.auth.signOut().catch(() => {});
    setParent(null);
  }, []);

  // A paired kid phone wins; a self phone is a signed-in parent account that set up "Just me".
  const session: Session | null = device ?? parent;
  return (
    <SessionContext.Provider value={{ session, loading, signInKid: signInDevice, signInSelf: signInDevice, intent, setIntent, signOut }}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

// Screens keep the last valid session while they unmount after sign-out, instead of crashing mid-transition.
export function useParentSession() {
  const { session } = useSession();
  const last = useRef<Extract<Session, { role: 'parent' }> | null>(null);
  if (session?.role === 'parent') last.current = session;
  if (!last.current) throw new Error('Parent session required');
  return last.current;
}

export function useKidSession() {
  const { session } = useSession();
  const last = useRef<Extract<Session, { role: 'kid' }> | null>(null);
  if (session?.role === 'kid') last.current = session;
  if (!last.current) throw new Error('Kid session required');
  return last.current;
}

export function useSelfSession() {
  const { session } = useSession();
  const last = useRef<Extract<Session, { role: 'self' }> | null>(null);
  if (session?.role === 'self') last.current = session;
  if (!last.current) throw new Error('Self session required');
  return last.current;
}
