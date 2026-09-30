import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { KidConfig, Message } from '@mello/shared';
import { MelloBlocker } from '../../modules/mello-blocker';
import { isUnpaired, kidApi } from './api';
import { readJson, writeJson } from './cache';

const CONFIG_CACHE = 'kid-config';

export function cachedConfig(): KidConfig | null {
  return readJson<KidConfig | null>(CONFIG_CACHE, null);
}

/**
 * Pulls rules and the current book from the backend and hands the blocked-app list to the native gate.
 * If the network is down the last cached config stays in force, so the gate never silently switches off.
 */
export async function syncKid(token: string, opts: { uploadDevice?: boolean } = {}): Promise<KidConfig | null> {
  const api = kidApi(token);
  if (opts.uploadDevice) {
    const [pushToken, apps] = await Promise.all([registerForPush(), MelloBlocker.getInstalledApps().catch(() => [])]);
    await api.updateDevice(pushToken, apps.length ? apps : null).catch((e) => console.warn('[sync] device upload failed', e));
  }
  try {
    const config = await api.config();
    writeJson(CONFIG_CACHE, config);
    applyRules(config);
    return config;
  } catch (err) {
    if (isUnpaired(err)) throw err;
    console.warn('[sync] using cached config', err);
    const cached = cachedConfig();
    if (cached) applyRules(cached);
    return cached;
  }
}

function applyRules(config: KidConfig) {
  const blocked = new Set(config.rules.filter((r) => r.enabled).flatMap((r) => r.apps));
  MelloBlocker.setBlockedPackages([...blocked]);
}

/** Turns the gate off and forgets this kid's data. Call only after the backend has signed the phone out. */
export function clearKidDevice() {
  MelloBlocker.setBlockedPackages([]);
  writeJson(CONFIG_CACHE, null);
  writeJson('progress', {});
}

async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Messages from home',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return null;
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    // Without an EAS project there is no push token; the app still picks up changes when it opens.
    if (!projectId) return null;
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (err) {
    console.warn('[push] registration failed', err);
    return null;
  }
}

let playing = false;

/** Plays every unplayed message from home, oldest first, then marks each one played. */
export async function playPendingMessages(token: string, onPlay?: (m: Message) => void) {
  if (playing) return;
  playing = true;
  try {
    const api = kidApi(token);
    const messages = (await api.unplayedMessages()).reverse();
    if (messages.length) await setAudioModeAsync({ playsInSilentMode: true });
    for (const m of messages) {
      onPlay?.(m);
      if (m.kind === 'audio' && m.audioUrl) await playUrl(m.audioUrl);
      else if (m.text) await speak(m.text);
      await api.markPlayed(m.id);
    }
  } catch (err) {
    console.warn('[messages] playback failed', err);
  } finally {
    playing = false;
  }
}

function speak(text: string) {
  return new Promise<void>((resolve) => {
    Speech.speak(text, { rate: 0.95, onDone: resolve, onStopped: resolve, onError: () => resolve() });
  });
}

function playUrl(url: string) {
  return new Promise<void>((resolve) => {
    const player = createAudioPlayer(url);
    const done = () => {
      sub.remove();
      player.remove();
      resolve();
    };
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (s.didJustFinish) done();
    });
    player.play();
    // Safety net so a broken file never blocks the queue.
    setTimeout(done, 5 * 60_000);
  });
}
