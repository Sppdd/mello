import { useCallback, useMemo, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { AppCategory, AppLimit, InstalledApp, KidConfig, QuietHours, SelfProfile } from '@mello/shared';
import { parentApi, selfApi } from '@/lib/api';
import { syncKid } from '@/lib/kid';
import { useSelfSession } from '@/lib/session';
import { BedtimeSection } from '@/components/parentSections';
import { Button, Card, Chip, colors, ErrorText, Field, Label, Muted, Screen } from '@/components/ui';

const FOCUS_MINUTES = [10, 15, 20, 30, 45, 60];
const LIMIT_MINUTES = [0, 15, 30, 45, 60, 90];

/**
 * Your goals, built from the same pieces a parent uses: "N minutes in an app" tasks (optionally
 * before other apps open), daily limits, and wind-down hours. Plus interests the companion suggests from.
 */
export default function Goals() {
  const session = useSelfSession();
  const api = useMemo(() => parentApi(), []);
  const [config, setConfig] = useState<KidConfig | null>(null);
  const [profile, setProfile] = useState<SelfProfile | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([syncKid(session.token), selfApi().profile()]);
      setConfig(c);
      setProfile(p);
    } catch (e) {
      setError(e);
    }
  }, [session.token]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!config) return <Screen>{error ? <ErrorText error={error} /> : <Muted>Loading…</Muted>}</Screen>;
  const kid = config.kid;
  const label = (pkg: string) => kid.installedApps.find((a) => a.packageName === pkg)?.label ?? pkg;
  const run = (fn: () => Promise<unknown>) =>
    fn()
      .then(load)
      .catch(setError);

  return (
    <Screen>
      <ErrorText error={error} />
      <Card>
        <Label>Daily focus goals</Label>
        {config.tasks.filter((t) => t.kind === 'app').length === 0 && <Muted>None yet.</Muted>}
        {config.tasks
          .filter((t) => t.kind === 'app')
          .map((t) => {
            const before = config.rules.filter((r) => r.taskId === t.id).flatMap((r) => r.apps);
            return (
              <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, color: colors.ink, fontSize: 16 }}>
                  {t.requiredMinutes} min in {label(t.appPackage ?? '')}
                  {before.length ? ` before ${before.map(label).join(', ')}` : ''}
                </Text>
                <Button title="Remove" variant="secondary" onPress={() => run(() => api.deleteTask(t.id))} />
              </View>
            );
          })}
        <AddFocusGoal apps={kid.installedApps} onAdd={(input) => run(() => addFocusGoal(api, kid.id, input))} />
      </Card>

      <LimitsCard apps={kid.installedApps} limits={config.limits} label={label} onSet={(l) => run(() => api.setLimit(kid.id, l))} onRemove={(p) => run(() => api.deleteLimit(kid.id, p))} />

      <BedtimeSection kid={kid} quiet={config.quietHours} api={api} onChange={load} />

      {profile && <Interests profile={profile} onSave={(p) => run(() => selfApi().updateProfile(p).then(setProfile))} />}
    </Screen>
  );
}

async function addFocusGoal(api: ReturnType<typeof parentApi>, subjectId: string, input: { app: InstalledApp; minutes: number; before: string[] }) {
  const task = await api.addTask(subjectId, { kind: 'app', title: `${input.minutes} min in ${input.app.label}`, appPackage: input.app.packageName, requiredMinutes: input.minutes });
  if (input.before.length) await api.addRule(subjectId, { apps: input.before, activity: 'task', taskId: task.id, minutesRequired: Math.min(input.minutes, 120) });
}

function AddFocusGoal({ apps, onAdd }: { apps: InstalledApp[]; onAdd: (i: { app: InstalledApp; minutes: number; before: string[] }) => void }) {
  const [app, setApp] = useState<InstalledApp | null>(null);
  const [minutes, setMinutes] = useState(20);
  const [before, setBefore] = useState<string[]>([]);
  const good = apps.filter((a) => a.category === 'reading' || a.category === 'audio');
  const tempting = apps.filter((a) => a.category === 'social' || a.category === 'video' || a.category === 'game');
  return (
    <View style={{ gap: 8 }}>
      <Label>Add: time in…</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(good.length ? good : apps).map((a) => (
          <Chip key={a.packageName} label={a.label} selected={app?.packageName === a.packageName} onPress={() => setApp(a)} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {FOCUS_MINUTES.map((m) => (
          <Chip key={m} label={`${m} min`} selected={minutes === m} onPress={() => setMinutes(m)} />
        ))}
      </View>
      <Label>…before opening (optional)</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(tempting.length ? tempting : apps).map((a) => (
          <Chip
            key={a.packageName}
            label={a.label}
            selected={before.includes(a.packageName)}
            onPress={() => setBefore((b) => (b.includes(a.packageName) ? b.filter((x) => x !== a.packageName) : [...b, a.packageName]))}
          />
        ))}
      </View>
      <Button
        title="Add goal"
        disabled={!app}
        onPress={() => {
          if (!app) return;
          onAdd({ app, minutes, before });
          setApp(null);
          setBefore([]);
        }}
      />
    </View>
  );
}

const CATEGORY_LABELS: Partial<Record<AppCategory, string>> = { social: 'all social apps', video: 'all video apps', game: 'all games' };

function LimitsCard({
  apps,
  limits,
  label,
  onSet,
  onRemove,
}: {
  apps: InstalledApp[];
  limits: AppLimit[];
  label: (p: string) => string;
  onSet: (l: AppLimit) => void;
  onRemove: (p: string) => void;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(30);
  const categories = (Object.keys(CATEGORY_LABELS) as AppCategory[]).filter((c) => apps.some((a) => a.category === c));
  const targets = target?.startsWith('cat:') ? apps.filter((a) => a.category === target.slice(4)).map((a) => a.packageName) : target ? [target] : [];
  return (
    <Card>
      <Label>Daily limits</Label>
      {limits.map((l) => (
        <View key={l.packageName} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, color: colors.ink, fontSize: 16 }}>
            {label(l.packageName)}: {l.dailyMinutes === 0 ? 'off' : `${l.dailyMinutes} min/day`}
          </Text>
          <Button title="Remove" variant="secondary" onPress={() => onRemove(l.packageName)} />
        </View>
      ))}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {categories.map((c) => (
          <Chip key={c} label={CATEGORY_LABELS[c]!} selected={target === `cat:${c}`} onPress={() => setTarget(`cat:${c}`)} />
        ))}
        {apps
          .filter((a) => a.category !== 'reading' && a.category !== 'audio')
          .map((a) => (
            <Chip key={a.packageName} label={a.label} selected={target === a.packageName} onPress={() => setTarget(a.packageName)} />
          ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {LIMIT_MINUTES.map((m) => (
          <Chip key={m} label={m === 0 ? 'Off for the day' : `${m} min`} selected={minutes === m} onPress={() => setMinutes(m)} />
        ))}
      </View>
      <Muted>A limit on a category applies to each of its apps.</Muted>
      <Button
        title="Save limit"
        disabled={!targets.length}
        onPress={() => {
          for (const p of targets) onSet({ packageName: p, dailyMinutes: minutes });
          setTarget(null);
        }}
      />
    </Card>
  );
}

function Interests({ profile, onSave }: { profile: SelfProfile; onSave: (p: { interests?: string[]; alwaysSuggest?: boolean }) => void }) {
  const [topic, setTopic] = useState('');
  return (
    <Card>
      <Label>Interests</Label>
      <Muted>Your companion suggests books, podcasts and topics from these.</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {profile.interests.map((t) => (
          <Chip key={t} label={`${t} ✕`} selected onPress={() => onSave({ interests: profile.interests.filter((x) => x !== t) })} />
        ))}
      </View>
      <Field label="Add a topic" value={topic} onChangeText={setTopic} placeholder="Stoicism, space history, cooking…" />
      <Button
        title="Add"
        variant="secondary"
        disabled={!topic.trim()}
        onPress={() => {
          onSave({ interests: [...profile.interests, topic.trim()].slice(-20) });
          setTopic('');
        }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Muted>Always suggest something</Muted>
        <Switch value={profile.alwaysSuggest} onValueChange={(alwaysSuggest) => onSave({ alwaysSuggest })} />
      </View>
    </Card>
  );
}
