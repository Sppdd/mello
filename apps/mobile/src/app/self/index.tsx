import { useCallback, useEffect, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { characterLine, displayName, type KidConfig, type Mood, type Streak } from '@mello/shared';
import { MelloBlocker, type PendingBlock } from '../../../modules/mello-blocker';
import { useSelfSession, useSession } from '@/lib/session';
import { isUnpaired, selfApi } from '@/lib/api';
import { cachedConfig, clearKidDevice, syncKid } from '@/lib/kid';
import { writeJson } from '@/lib/cache';
import { appTaskFor, greeting, minutesLeftOn, uploadUsage } from '@/lib/self';
import { CharacterSays } from '@/components/Character';
import { Button, Card, colors, Label, Muted, Screen } from '@/components/ui';

export default function SelfHome() {
  const session = useSelfSession();
  const { signOut } = useSession();
  const [config, setConfig] = useState<KidConfig | null>(() => cachedConfig());
  const [streak, setStreak] = useState<Streak | null>(null);
  const [gateOn, setGateOn] = useState(() => MelloBlocker.isServiceEnabled());
  const [usageOn, setUsageOn] = useState(() => MelloBlocker.isUsageAccessGranted());
  const [stopped, setStopped] = useState<PendingBlock | null>(null);

  const prefs = config?.kid.settings.character;
  const name = config?.kid.name ?? session.name;
  const label = (pkg: string) => config?.kid.installedApps.find((a) => a.packageName === pkg)?.label ?? pkg;

  // A rule whose task is "time in an app" starts a focus session there; anything else explains why the app waits.
  const openGate = useCallback(
    (block: PendingBlock) => {
      const c = cachedConfig();
      const task = block.reason === 'rule' ? appTaskFor(c, block.packageName) : null;
      // Goal already done today (e.g. the unlock ran out): open the app again without another session.
      if (task && c?.taskProgress.find((p) => p.taskId === task.id)?.completed) {
        const rule = c.rules.find((r) => r.taskId === task.id && r.apps.includes(block.packageName));
        MelloBlocker.unlock(block.packageName, rule?.unlockMinutes ?? 30);
        MelloBlocker.launchApp(block.packageName);
        return;
      }
      if (task?.appPackage) {
        setStopped(null);
        router.push({ pathname: '/self/focus', params: { app: task.appPackage, minutes: String(minutesLeftOn(c, task)), taskId: task.id, gated: block.packageName } });
        return;
      }
      setStopped(block);
    },
    [],
  );

  // A focus session ended (time done, or break-glass): go reflect.
  const checkFocusResult = useCallback(() => {
    const result = MelloBlocker.consumeFocusResult();
    if (!result) return;
    writeJson('last-focus-result', result);
    router.push('/self/reflect');
  }, []);

  const refresh = useCallback(
    async (uploadDevice = false) => {
      setGateOn(MelloBlocker.isServiceEnabled());
      setUsageOn(MelloBlocker.isUsageAccessGranted());
      try {
        const c = await syncKid(session.token, { uploadDevice });
        if (c) {
          setConfig(c);
          await uploadUsage(c).catch((e) => console.warn('[self] usage upload failed', e));
        }
        setStreak((await selfApi().usage(30)).streak);
      } catch (err) {
        if (isUnpaired(err)) {
          clearKidDevice();
          await signOut();
        }
      }
    },
    [session.token, signOut],
  );

  useEffect(() => {
    refresh(true);
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      checkFocusResult();
      const pending = MelloBlocker.consumePendingBlockedApp();
      if (pending) openGate(pending);
      const sub = AppState.addEventListener('change', (s) => {
        if (s !== 'active') return;
        checkFocusResult();
        const p = MelloBlocker.consumePendingBlockedApp();
        if (p) openGate(p);
        refresh();
      });
      return () => sub.remove();
    }, [checkFocusResult, openGate, refresh]),
  );

  useEffect(() => {
    const offBlocked = MelloBlocker.addBlockedListener(() => {
      const p = MelloBlocker.consumePendingBlockedApp();
      if (p) openGate(p);
    });
    const offFocus = MelloBlocker.addFocusEndedListener(checkFocusResult);
    return () => {
      offBlocked();
      offFocus();
    };
  }, [openGate, checkFocusResult]);

  const running = MelloBlocker.getFocus();
  let mood: Mood = 'happy';
  let line = config ? greeting(config) : `Hi ${name}!`;
  if (MelloBlocker.isSupported() && !gateOn) {
    mood = 'worried';
    line = characterLine(prefs, 'guard_off', { name });
  } else if (streak && streak.current > 0 && !streak.todayDone) {
    line = characterLine(prefs, 'streak_risk', { streak: streak.current, name });
  } else if (streak?.todayDone) {
    mood = 'proud';
    line = characterLine(prefs, 'streak_up', { streak: streak.current, name });
  }

  const goals = config?.tasks.filter((t) => t.kind === 'app') ?? [];

  return (
    <Screen>
      <CharacterSays prefs={prefs} mood={mood} text={line} size={84} />

      {running && (
        <Card>
          <Label>Focus running: {running.label}</Label>
          <Button title="Open" onPress={() => router.push('/self/focus')} />
        </Card>
      )}

      {stopped && (
        <Card>
          <Label>{stopped.reason === 'bedtime' ? '🌙 Wind-down time' : stopped.reason === 'limit' ? `⏰ ${label(stopped.packageName)} is done for today` : `${label(stopped.packageName)} is waiting`}</Label>
          <Muted>
            {stopped.reason === 'bedtime'
              ? `You asked for quiet evenings. ${label(stopped.packageName)} opens again in the morning.`
              : stopped.reason === 'limit'
                ? 'You used the time you gave it today. It opens again tomorrow.'
                : 'You set a goal to do first. Check your goals.'}
          </Muted>
          <Button title="OK" variant="secondary" onPress={() => setStopped(null)} />
        </Card>
      )}

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={{ fontSize: 40 }}>{streak?.todayDone ? '🔥' : '🕯️'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>{streak?.current ?? 0}-day streak</Text>
            <Muted>
              {streak?.todayDone
                ? 'Today counts. Nice.'
                : 'Keep your guard on and meet one goal today.'}
              {streak && streak.best > 0 ? ` Best: ${streak.best}.` : ''}
              {streak?.frozen.length ? ` ${streak.frozen.length} freeze used.` : ''}
            </Muted>
          </View>
        </View>
      </Card>

      {MelloBlocker.isSupported() && !gateOn && (
        <Card>
          <Label>Turn your guard on</Label>
          <Muted>
            {displayName(prefs)} needs the "Mello reading gate" accessibility service to keep your goals and limits. It only sees which app is open, never
            what's on screen. You can switch it off any time; it just shows in your streak.
          </Muted>
          <Button title="Open settings" onPress={() => MelloBlocker.openServiceSettings()} />
        </Card>
      )}
      {MelloBlocker.isSupported() && !usageOn && (
        <Card>
          <Label>Let me see your habits</Label>
          <Muted>Turn on "Usage access" for Mello to count minutes and opens per app. Only daily totals leave your phone.</Muted>
          <Button title="Open settings" onPress={() => MelloBlocker.openUsageAccessSettings()} />
        </Card>
      )}

      <Card>
        <Label>Today</Label>
        {goals.length === 0 && <Muted>No goals yet. Try "20 minutes in my reading app before Instagram".</Muted>}
        {goals.map((t) => {
          const p = config?.taskProgress.find((x) => x.taskId === t.id);
          const done = !!p?.completed;
          return (
            <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ flex: 1, fontSize: 16, color: colors.ink }}>
                {done ? '✅' : '⬜️'} {t.title} · {done ? `${t.requiredMinutes} min` : `${minutesLeftOn(config, t)} min left`}
              </Text>
              {!done && t.appPackage && (
                <Button
                  title="Start"
                  variant="secondary"
                  onPress={() => router.push({ pathname: '/self/focus', params: { app: t.appPackage!, minutes: String(minutesLeftOn(config, t)), taskId: t.id } })}
                />
              )}
            </View>
          );
        })}
        <Button title="Focus now" onPress={() => router.push('/self/focus')} />
      </Card>

      <Button title={`Talk to ${displayName(prefs)}`} onPress={() => router.push('/self/coach')} />
      <Button title="Your habits" variant="secondary" onPress={() => router.push('/self/insights')} />
      <Button title="Goals & interests" variant="secondary" onPress={() => router.push('/self/goals')} />
      <Button title="Your companion" variant="secondary" onPress={() => router.push('/self/character')} />
      <Button title="Sign out" variant="secondary" onPress={() => router.push('/self/signout')} />
    </Screen>
  );
}
