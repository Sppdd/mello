import 'react-native-get-random-values';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as aesjs from 'aes-js';
import { createClient } from '@supabase/supabase-js';

/**
 * Supabase sessions are too big for SecureStore's per-item limit, so the session is AES-encrypted
 * in AsyncStorage and only the key lives in the Keystore/Keychain (the pattern from Supabase's Expo guide).
 */
class LargeSecureStore {
  private async encrypt(key: string, value: string) {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8));
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encrypted = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));
    return aesjs.utils.hex.fromBytes(encrypted);
  }
  private async decrypt(key: string, value: string) {
    const keyHex = await SecureStore.getItemAsync(key);
    if (!keyHex) return keyHex;
    const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(keyHex), new aesjs.Counter(1));
    return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(value)));
  }
  async getItem(key: string) {
    const encrypted = await AsyncStorage.getItem(key);
    return encrypted ? this.decrypt(key, encrypted) : encrypted;
  }
  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }
  async setItem(key: string, value: string) {
    await AsyncStorage.setItem(key, await this.encrypt(key, value));
  }
}

export const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
  auth: { storage: new LargeSecureStore(), autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

// Refresh tokens only while the app is in the foreground, as Supabase recommends for React Native.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

/** Current parent access token (refreshed if needed), or null when signed out. */
export async function parentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
