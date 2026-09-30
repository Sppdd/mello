import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';

/** Which side of Mello this phone is. Stored in the keychain/keystore, never in plain storage. */
export type Session =
  | { role: 'parent'; token: string; familyName: string }
  | { role: 'kid'; token: string; kidId: string; kidName: string };

const KEY = 'mello.session';

type Ctx = {
  session: Session | null;
  loading: boolean;
  signIn: (s: Session) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((raw) => setSession(raw ? (JSON.parse(raw) as Session) : null))
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (s: Session) => {
    await SecureStore.setItemAsync(KEY, JSON.stringify(s));
    setSession(s);
  }, []);

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(KEY);
    setSession(null);
  }, []);

  return <SessionContext.Provider value={{ session, loading, signIn, signOut }}>{children}</SessionContext.Provider>;
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
