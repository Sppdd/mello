import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { characterLine, type AppCategory, type InstalledApp } from '@mello/shared';
import { MelloBlocker, type Focus } from '../../../modules/mello-blocker';
import { cachedConfig } from '@/lib/kid';
import { writeJson } from '@/lib/cache';
import { startFocus } from '@/lib/self';
import { CharacterSays } from '@/components/Character';
import { Button, Card, Chip, colors, Field, Label, Muted, Screen } from '@/components/ui';

const MINUTES = [5, 10, 20, 30, 45, 60];
const HOLD_MS = 10_000;
/** Apps that are good to get lost in, listed first. */
const GOOD: AppCategory[] = ['reading', 'audio'];

/**
 * Pick an app and a time, then Mello keeps you in that app until the time is in (only while you're
 * actually using it). Arriving from a gate or a goal pre-fills both.
 */
export default function FocusScreen() {
  const params = useLocalSearchParams<{ app?: string; minutes?: string; taskId?: string; gated?: string }>();
  const config = useMemo(() => cachedConfig(), []);
  const prefs = config?.kid.settings.character;
  const apps = config?.kid.installedApps ?? [];
  const sorted = useMemo(
    () => [...apps].sort((a, b) => Number(GOOD.includes(b.category ?? 'other')) - Number(GOOD.includes(a.category ?? 'other')) || a.label.localeCompare(b.label)),
    [apps],
  );
  const [app, setApp] = useState<InstalledApp | null>(() => apps.find((a) => a.packageName === params.app) ?? null);
  const [minutes, setMinutes] = useState(() => Number(params.minutes) || 20);
  const [running, setRunning] = useState<Focus | null>(() => MelloBlocker.getFocus());

  useEffect(() => {
    const t = setInterval(() => setRunning(MelloBlocker.getFocus()), 2000);
    return () => clearInterval(t);
  }, []);

  const gatedLabel = params.gated ? apps.find((a) => a.packageName === params.gated)?.label ?? params.gated : null;

  if (running) return <Running focus={running} prefs={prefs} onEnded={() => router.back()} />;

  return (
    <Screen>
      <CharacterSays
        prefs={prefs}
        text={
          gatedLabel && app
            ? `${gatedLabel} is waiting. ${minutes} minutes in ${app.label} first?`
            : 'Pick something good to get lost in. I’ll keep you there.'
        }
      />
      <Card>
        <Label>Where to?</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {sorted.map((a) => (
            <Chip key={a.packageName} label={a.label} selected={app?.packageName === a.packageName} onPress={() => setApp(a)} />
          ))}
        </View>
        {apps.length === 0 && <Muted>Your app list hasn't loaded yet. Go back and pull to refresh.</Muted>}
      </Card>
      <Card>
        <Label>For how long?</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {MINUTES.map((m) => (
            <Chip key={m} label={`${m} min`} selected={minutes === m} onPress={() => setMinutes(m)} />
          ))}
        </View>
        <Muted>Time only counts while you're using the app. Leaving sends you back; calls always work.</Muted>
      </Card>
      {!MelloBlocker.isServiceEnabled() && MelloBlocker.isSupported() && (
        <Muted>Your guard is off, so I can't keep you in the app. Turn it on from the home screen.</Muted>
      )}
      <Button
        title={app ? `Start ${minutes} min in ${app.label}` : 'Pick an app'}
        disabled={!app}
        onPress={() => {
          if (!app) return;
          startFocus(app, minutes, { taskId: params.taskId ?? null, gatedApp: params.gated ?? null });
          setRunning(MelloBlocker.getFocus());
        }}
      />
    </Screen>
  );
}

/** While a session runs: time left, a way back in, and break-glass (hold 10 s, then say why). */
function Running({ focus, prefs, onEnded }: { focus: Focus; prefs: Parameters<typeof characterLine>[0]; onEnded: () => void }) {
  const left = Math.max(0, Math.ceil((focus.requiredMs - focus.elapsedMs) / 60_000));
  const [holding, setHolding] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [why, setWhy] = useState('');
  const progress = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startHold = () => {
    setHolding(true);
    Animated.timing(progress, { toValue: 1, duration: HOLD_MS, useNativeDriver: false }).start();
    timer.current = setTimeout(() => setUnlocked(true), HOLD_MS);
  };
  const endHold = () => {
    setHolding(false);
    if (timer.current) clearTimeout(timer.current);
    if (!unlocked) progress.setValue(0);
  };

  return (
    <Screen>
      <CharacterSays prefs={prefs} text={characterLine(prefs, 'focus_start', { minutes: left, app: focus.label })} />
      <Card>
        <Text style={{ fontSize: 40, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>{left} min</Text>
        <Muted>left in {focus.label}</Muted>
        <Button title={`Back to ${focus.label}`} onPress={() => MelloBlocker.launchApp(focus.target)} />
      </Card>
      <Card>
        <Label>I really need to stop</Label>
        {!unlocked ? (
          <>
            <Muted>Hold the button for 10 seconds. It's logged in your streak, honestly, without judgement.</Muted>
            <Pressable
              onPressIn={startHold}
              onPressOut={endHold}
              accessibilityRole="button"
              accessibilityHint="Hold for ten seconds to end the focus session early"
              style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', backgroundColor: colors.card }}
            >
              <Animated.View
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  backgroundColor: '#F3D3D3',
                  width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                }}
              />
              <Text style={{ padding: 14, textAlign: 'center', fontSize: 16, fontWeight: '600', color: colors.ink }}>{holding ? 'Keep holding…' : 'Hold to stop'}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Field label="What's pulling you away?" value={why} onChangeText={setWhy} placeholder="A call, a friend, I'm bored…" />
            <Button
              title="Stop the session"
              variant="danger"
              disabled={why.trim().length < 3}
              onPress={() => {
                writeJson('break-glass-why', why.trim().slice(0, 200));
                MelloBlocker.breakGlass();
                onEnded();
              }}
            />
          </>
        )}
      </Card>
    </Screen>
  );
}
