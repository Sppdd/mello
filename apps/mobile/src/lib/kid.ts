import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { categoryFor, characterLine, characterOf, displayName, type InstalledApp, type KidConfig, type Message } from '@mello/shared';
import { MelloBlocker } from '../../modules/mello-blocker';
import { isUnpaired, kidApi } from './api';
import { readJson, writeJson } from './cache';
import { speakAs } from './voice';

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
    const [pushToken, apps] = await Promise.all([registerForPush(), installedApps()]);
    await api
      .updateDevice({
        pushToken,
        installedApps: apps.length ? apps : null,
        status: { gateEnabled: MelloBlocker.isServiceEnabled(), usageAccessEnabled: MelloBlocker.isUsageAccessGranted() },
      })
      .catch((e) => console.warn('[sync] device upload failed', e));
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

/** Launchable apps with a category (social, reading, …) for goals and insights. */
export async function installedApps(): Promise<InstalledApp[]> {
  const apps = await MelloBlocker.getInstalledApps().catch(() => []);
  return apps.map(({ packageName, label, androidCategory }) => ({ packageName, label, category: categoryFor(packageName, androidCategory) }));
}

/** Hands the rules to the native gate, which enforces them even when Mello isn't open. */
function applyRules(config: KidConfig) {
  const blocked = new Set(config.rules.filter((r) => r.enabled).flatMap((r) => r.apps));
  MelloBlocker.setBlockedPackages([...blocked]);
  MelloBlocker.setLimits(Object.fromEntries(config.limits.map((l) => [l.packageName, l.dailyMinutes])));
  MelloBlocker.setQuietHours(config.quietHours);
  MelloBlocker.setBubble(true, suggestions(config));
  // The bubble and (in self mode) guard-off reminders speak as the chosen character.
  const prefs = config.kid.settings.character;
  const name = displayName(prefs);
  MelloBlocker.setCharacter(name, characterOf(prefs).colors.accent, { guard_off: characterLine(prefs, 'guard_off', { name }) }, config.kid.kind === 'self');
}

/** Short "what to do next" lines for the floating bubble and the home screen. */
export function suggestions(config: KidConfig): string[] {
  const label = (pkg: string) => config.kid.installedApps.find((a) => a.packageName === pkg)?.label ?? pkg;
  const lines: string[] = [];
  for (const t of config.tasks) {
    const p = config.taskProgress.find((x) => x.taskId === t.id);
    if (p?.completed) continue;
    const left = Math.max(1, Math.ceil(t.requiredMinutes - (p?.seconds ?? 0) / 60));
    if (t.kind === 'app') {
      lines.push(`${left} min in ${label(t.appPackage ?? '')}: ${t.title}`);
      continue;
    }
    const verb = { audio: 'Listen to', video: 'Watch', article: 'Read', reading: 'Read' }[t.kind];
    lines.push(`${verb} "${t.title}" (${left} min left)`);
  }
  for (const r of config.rules.filter((r) => r.enabled && r.activity === 'reading')) {
    lines.push(`Read ${r.minutesRequired} min to open ${r.apps.map(label).join(', ')}`);
  }
  if (config.quietHours?.enabled) {
    const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    lines.push(`Bedtime ${hm(config.quietHours.startMinute)}–${hm(config.quietHours.endMinute)}`);
  }
  return lines.slice(0, 4);
}

/** Turns the gate off and forgets this kid's data. Call only after the backend has signed the phone out. */
export function clearKidDevice() {
  MelloBlocker.setBlockedPackages([]);
  MelloBlocker.setLimits({});
  MelloBlocker.setQuietHours(null);
  if (MelloBlocker.getFocus()) MelloBlocker.breakGlass();
  MelloBlocker.consumeFocusResult();
  MelloBlocker.setCharacter('Mello', '#0F766E', {}, false);
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
      else if (m.text) await speakAs(cachedConfig()?.kid.settings.character, m.text);
      await api.markPlayed(m.id);
    }
  } catch (err) {
    console.warn('[messages] playback failed', err);
  } finally {
    playing = false;
  }
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
