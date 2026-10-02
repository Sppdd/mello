import { createClient } from '@supabase/supabase-js';

/** Turns a parent's bearer token into their user id, or null if it isn't valid. */
export type VerifyParentToken = (token: string) => Promise<string | null>;

/**
 * Parents sign in with Supabase Auth on the phone and send their access token.
 * getClaims verifies the JWT (locally via JWKS for asymmetric keys, otherwise via the Auth server).
 */
export function supabaseVerifier(url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY): VerifyParentToken {
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set');
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return async (token) => {
    if (!token) return null;
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) return null;
    return data.claims.sub;
  };
}
