import { useCallback, useEffect, useState } from 'react';
import { AppState, Text } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Notifications from 'expo-notifications';
import type { KidConfig, Message } from '@mello/shared';
import { MelloBlocker, type PendingBlock } from '../../../modules/mello-blocker';
import { useKidSession, useSession } from '@/lib/session';
import { isUnpaired, kidApi } from '@/lib/api';
import { cachedConfig, clearKidDevice, playPendingMessages, suggestions, syncKid } from '@/lib/kid';
import { characterLine } from '@mello/shared';
import { CharacterSays } from '@/components/Character';
import { Button, Card, colors, Label, Muted, Screen } from '@/components/ui';

export default function KidHome() {
  const session = useKidSession();
  const { signOut } = useSession();
  const [config, setConfig] = useState<KidConfig | null>(() => cachedConfig());
  const [gateOn, setGateOn] = useState(() => MelloBlocker.isServiceEnabled());
  const [nowPlaying, setNowPlaying] = useState<Message | null>(null);
  const [usageOn, setUsageOn] = useState(() => MelloBlocker.isUsageAccessGranted());
  const [stopped, setStopped] = useState<PendingBlock | null>(null);

  const appLabel = (pkg: string) => config?.kid.installedApps.find((a) => a.packageName === pkg)?.label ?? pkg;

  // Read-first rules open the reader; a used-up limit or bedtime just explains why the app can't open.
  const openGate = useCallback(
    (block: PendingBlock) => {
      if (block.reason === 'rule') {
        setStopped(null);
        router.push({ pathname: '/kid/read', params: { gate: block.packageName } });
        return;
      }
      setStopped(block);
      kidApi(session.token)
        .alert(block.reason === 'bedtime' ? 'bedtime_attempt' : 'limit_reached', { app: block.packageName })
        .catch(() => {});
    },
    [session.token],
  );

  const refresh = useCallback(
    async (uploadDevice = false) => {
      setGateOn(MelloBlocker.isServiceEnabled());
      setUsageOn(MelloBlocker.isUsageAccessGranted());
      try {
        const c = await syncKid(session.token, { uploadDevice });
        if (c) setConfig(c);
      } catch (err) {
        // A parent signed this phone out (e.g. approved a request after the kid closed the screen).
        if (isUnpaired(err)) {
          clearKidDevice();
          await signOut();
          return;
        }
      }
      await playPendingMessages(session.token, setNowPlaying);
      setNowPlaying(null);
    },
    [session.token, signOut],
  );

  // First launch: share installed apps and push token with the parent.
  useEffect(() => {
    refresh(true);
  }, [refresh]);

  // Coming back to Mello (often because the gate sent us here): re-sync and handle the blocked app.
  useFocusEffect(
    useCallback(() => {
      const pending = MelloBlocker.consumePendingBlockedApp();
      if (pending) openGate(pending);
      const sub = AppState.addEventListener('change', (s) => {
        if (s !== 'active') return;
        const p = MelloBlocker.consumePendingBlockedApp();
        if (p) openGate(p);
        refresh();
      });
      return () => sub.remove();
    }, [openGate, refresh]),
  );

  useEffect(() => {
    const offBlocked = MelloBlocker.addBlockedListener(() => {
      const p = MelloBlocker.consumePendingBlockedApp();
      if (p) openGate(p);
    });
    const received = Notifications.addNotificationReceivedListener(() => refresh());
    const tapped = Notifications.addNotificationResponseReceivedListener(() => refresh());
    return () => {
      offBlocked();
      received.remove();
      tapped.remove();
    };
  }, [openGate, refresh]);

  const blockedCount = new Set(config?.rules.filter((r) => r.enabled).flatMap((r) => r.apps)).size;
  const todo = config ? suggestions(config) : [];

  return (
    <Screen>
      <CharacterSays
        prefs={config?.kid.settings.character}
        mood={gateOn || !MelloBlocker.isSupported() ? 'happy' : 'worried'}
        text={characterLine(config?.kid.settings.character, 'greet', { name: session.kidName }, new Date().getDate())}
      />

      {nowPlaying && (
        <Card>
          <Label>🔊 Message from home</Label>
          {nowPlaying.text && <Text style={{ fontSize: 18, color: colors.ink }}>{nowPlaying.text}</Text>}
        </Card>
      )}

      {stopped && (
        <Card>
          <Label>{stopped.reason === 'bedtime' ? '🌙 It’s bedtime' : `⏰ ${appLabel(stopped.packageName)} is done for today`}</Label>
          <Muted>
            {stopped.reason === 'bedtime'
              ? `${appLabel(stopped.packageName)} is off until morning. Your parent can see that you tried.`
              : 'You used today’s time for this app. It opens again tomorrow.'}
          </Muted>
          <Button title="OK" variant="secondary" onPress={() => setStopped(null)} />
        </Card>
      )}

      {todo.length > 0 && (
        <Card>
          <Label>To do</Label>
          {todo.map((line) => (
            <Text key={line} style={{ fontSize: 16, color: colors.ink }}>
              • {line}
            </Text>
          ))}
        </Card>
      )}

      {MelloBlocker.isSupported() && gateOn && !usageOn && (config?.limits.length ?? 0) > 0 && (
        <Card>
          <Label>Allow time limits (ask a grown-up)</Label>
          <Muted>Your parent set daily time limits. Turn on "Usage access" for Mello so it can count today's minutes per app.</Muted>
          <Button title="Open settings" onPress={() => MelloBlocker.openUsageAccessSettings()} />
        </Card>
      )}

      {MelloBlocker.isSupported() && !gateOn && (
        <Card>
          <Label>One more step (ask a grown-up)</Label>
          <Muted>Turn on "Mello reading gate" in Accessibility settings so Mello can ask for reading before the apps your parent picked.</Muted>
          <Button title="Open settings" onPress={() => MelloBlocker.openServiceSettings()} />
        </Card>
      )}

      <Card>
        <Label>Your book</Label>
        <Text style={{ fontSize: 20, fontWeight: '600', color: colors.ink }}>{config?.currentBook?.title ?? "Aesop's Fables"}</Text>
        {!config?.currentBook && <Muted>Your parent hasn't picked a book yet, so here's a classic.</Muted>}
        <Button title="Read" onPress={() => router.push('/kid/read')} />
      </Card>

      {blockedCount > 0 && (
        <Muted>
          {blockedCount === 1 ? '1 app needs' : `${blockedCount} apps need`} a little reading first.
        </Muted>
      )}

      <Button title="Change my buddy" variant="secondary" onPress={() => router.push('/kid/buddy')} />
      <Button title="Sign out of Mello" variant="secondary" onPress={() => router.push('/kid/signout')} />
    </Screen>
  );
}
