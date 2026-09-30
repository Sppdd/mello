import { useCallback, useEffect, useState } from 'react';
import { AppState, Text } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Notifications from 'expo-notifications';
import type { KidConfig, Message } from '@mello/shared';
import { MelloBlocker } from '../../../modules/mello-blocker';
import { useKidSession } from '@/lib/session';
import { cachedConfig, playPendingMessages, syncKid } from '@/lib/kid';
import { Button, Card, colors, Label, Muted, Screen, Title } from '@/components/ui';

export default function KidHome() {
  const session = useKidSession();
  const [config, setConfig] = useState<KidConfig | null>(() => cachedConfig());
  const [gateOn, setGateOn] = useState(() => MelloBlocker.isServiceEnabled());
  const [nowPlaying, setNowPlaying] = useState<Message | null>(null);

  const openGate = useCallback((packageName: string) => {
    router.push({ pathname: '/kid/read', params: { gate: packageName } });
  }, []);

  const refresh = useCallback(
    async (uploadDevice = false) => {
      setGateOn(MelloBlocker.isServiceEnabled());
      const c = await syncKid(session.token, { uploadDevice });
      if (c) setConfig(c);
      await playPendingMessages(session.token, setNowPlaying);
      setNowPlaying(null);
    },
    [session.token],
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

  return (
    <Screen>
      <Title>Hi {session.kidName}!</Title>

      {nowPlaying && (
        <Card>
          <Label>🔊 Message from home</Label>
          {nowPlaying.text && <Text style={{ fontSize: 18, color: colors.ink }}>{nowPlaying.text}</Text>}
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
          {blockedCount} app{blockedCount === 1 ? '' : 's'} need a little reading first.
        </Muted>
      )}
    </Screen>
  );
}
