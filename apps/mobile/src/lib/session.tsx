import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { supabase } from './supabase';

/**
 * Which side of Mello this phone is.
 * - Parent: a Supabase Auth account (email + password); the API gets its access token per request.
 * - Kid: a device token from pairing, kept in the Keystore/Keychain.
 */
export type Session = { role: 'parent'; userId: string; email: string } | { role: 'kid'; token: string; kidId: string; kidName: string };

const KID_KEY = 'mello.session';

type Ctx = {
  session: Session | null;
  loading: boolean;
  signInKid: (s: Extract<Session, { role: 'kid' }>) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [kid, setKid] = useState<Extract<Session, { role: 'kid' }> | null>(null);
  const [parent, setParent] = useState<Extract<Session, { role: 'parent' }> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      SecureStore.getItemAsync(KID_KEY).catch(() => null),
      supabase.auth.getSession().then(({ data }) => data.session),
    ])
      .then(([raw, s]) => {
        if (!mounted) return;
        const stored = raw ? JSON.parse(raw) : null;
        // Sessions saved before Supabase auth may still hold an old parent token; drop those.
        setKid(stored?.role === 'kid' ? stored : null);
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

  const signInKid = useCallback(async (s: Extract<Session, { role: 'kid' }>) => {
    await SecureStore.setItemAsync(KID_KEY, JSON.stringify(s));
    setKid(s);
  }, []);

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(KID_KEY);
    setKid(null);
    await supabase.auth.signOut().catch(() => {});
    setParent(null);
  }, []);

  // A phone is either a kid's phone or a parent's; a paired kid phone wins.
  const session: Session | null = kid ?? parent;
  return <SessionContext.Provider value={{ session, loading, signInKid, signOut }}>{children}</SessionContext.Provider>;
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
