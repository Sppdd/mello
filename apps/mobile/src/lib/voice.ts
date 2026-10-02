import { useSyncExternalStore } from 'react';
import * as Speech from 'expo-speech';
import { characterOf, type CharacterPrefs } from '@mello/shared';

/**
 * Mello's voice. Everything the app says out loud goes through here, so the on-screen Mello can move
 * its mouth while it talks.
 */
let speaking = false;
const listeners = new Set<() => void>();
const set = (v: boolean) => {
  speaking = v;
  listeners.forEach((l) => l());
};

export function speakAs(prefs: Partial<CharacterPrefs> | null | undefined, text: string): Promise<void> {
  const { pitch, rate } = characterOf(prefs).voice;
  return new Promise((resolve) => {
    const done = () => {
      set(false);
      resolve();
    };
    Speech.speak(text, { pitch, rate, onStart: () => set(true), onDone: done, onStopped: done, onError: done });
  });
}

export function useMelloSpeaking() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => speaking,
  );
}
