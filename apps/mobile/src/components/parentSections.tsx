import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import type { AppLimit, Kid, QuietHours, Task, TaskKind } from '@mello/shared';
import { router } from 'expo-router';
import type { ContentKind, ContentPick, parentApi, WeeklyInsight } from '@/lib/api';
import { Button, Card, Chip, colors, ErrorText, Field, Label, Muted } from './ui';

type Api = ReturnType<typeof parentApi>;

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const appLabel = (kid: Kid, pkg: string) => kid.installedApps.find((a) => a.packageName === pkg)?.label ?? pkg;

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function AppPicker({ kid, selected, onToggle }: { kid: Kid; selected: string[]; onToggle: (pkg: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {kid.installedApps.map((a) => (
        <Chip key={a.packageName} label={a.label} selected={selected.includes(a.packageName)} onPress={() => onToggle(a.packageName)} />
      ))}
    </View>
  );
}

// ---------- Daily limits ----------

const LIMIT_OPTIONS = [0, 15, 30, 60, 90, 120];

export function LimitsSection({ kid, limits, api, onChange }: { kid: Kid; limits: AppLimit[]; api: Api; onChange: () => void }) {
  const [app, setApp] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(30);
  const { busy, error, run } = useAction();

  return (
    <Card>
      <Label>Daily time limits</Label>
      <Muted>Counted on {kid.name}'s phone. A small bubble shows the time left; at 0 the app won't open until tomorrow.</Muted>
      {limits.map((l) => (
        <View key={l.packageName} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.ink, fontSize: 16 }}>
            {appLabel(kid, l.packageName)}: {l.dailyMinutes === 0 ? 'blocked' : `${l.dailyMinutes} min/day`}
          </Text>
          <Button title="Remove" variant="secondary" onPress={() => run(() => api.deleteLimit(kid.id, l.packageName)).then(onChange)} />
        </View>
      ))}
      {kid.installedApps.length > 0 && (
        <>
          <Label>Add a limit</Label>
          <AppPicker kid={kid} selected={app ? [app] : []} onToggle={(p) => setApp(app === p ? null : p)} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {LIMIT_OPTIONS.map((m) => (
              <Chip key={m} label={m === 0 ? 'Block' : `${m} min`} selected={minutes === m} onPress={() => setMinutes(m)} />
            ))}
          </View>
          <ErrorText error={error} />
          <Button
            title="Save limit"
            busy={busy}
            disabled={!app}
            onPress={() => run(() => api.setLimit(kid.id, { packageName: app!, dailyMinutes: minutes })).then((ok) => ok && (setApp(null), onChange()))}
          />
        </>
      )}
    </Card>
  );
}

// ---------- Bedtime ----------

const STARTS = [19 * 60, 20 * 60, 21 * 60, 21 * 60 + 30, 22 * 60];
const ENDS = [6 * 60, 6 * 60 + 30, 7 * 60, 8 * 60];

export function BedtimeSection({ kid, quiet, api, onChange }: { kid: Kid; quiet: QuietHours | null; api: Api; onChange: () => void }) {
  const [q, setQ] = useState<QuietHours>(quiet ?? { enabled: false, startMinute: 21 * 60, endMinute: 7 * 60, allowedApps: [] });
  const { busy, error, run } = useAction();
  const toggleApp = (pkg: string) =>
    setQ((v) => ({ ...v, allowedApps: v.allowedApps.includes(pkg) ? v.allowedApps.filter((p) => p !== pkg) : [...v.allowedApps, pkg] }));

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label>Bedtime</Label>
        <Switch value={q.enabled} onValueChange={(enabled) => setQ((v) => ({ ...v, enabled }))} />
      </View>
      <Muted>During bedtime only the apps you allow will open. Calls always work.</Muted>
      {q.enabled && (
        <>
          <Label>Starts</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {STARTS.map((m) => (
              <Chip key={m} label={hm(m)} selected={q.startMinute === m} onPress={() => setQ((v) => ({ ...v, startMinute: m }))} />
            ))}
          </View>
          <Label>Ends</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {ENDS.map((m) => (
              <Chip key={m} label={hm(m)} selected={q.endMinute === m} onPress={() => setQ((v) => ({ ...v, endMinute: m }))} />
            ))}
          </View>
          {kid.installedApps.length > 0 && (
            <>
              <Label>Still allowed at bedtime</Label>
              <AppPicker kid={kid} selected={q.allowedApps} onToggle={toggleApp} />
            </>
          )}
        </>
      )}
      <ErrorText error={error} />
      <Button title="Save bedtime" busy={busy} onPress={() => run(() => api.setQuietHours(kid.id, q)).then((ok) => ok && onChange())} />
    </Card>
  );
}

// ---------- Tasks ----------

const KINDS: { kind: TaskKind; label: string; urlHint: string | null }[] = [
  { kind: 'video', label: 'YouTube video', urlHint: 'YouTube link' },
  { kind: 'audio', label: 'Audio / podcast', urlHint: 'Link to an audio file (https)' },
  { kind: 'article', label: 'Article', urlHint: 'Link to the article (https)' },
  { kind: 'reading', label: 'Read their book', urlHint: null },
];
const TASK_MINUTES = [5, 10, 15, 20, 30];

export function TasksSection({ kid, tasks, api, onChange }: { kid: Kid; tasks: Task[]; api: Api; onChange: () => void }) {
  const [kind, setKind] = useState<TaskKind>('video');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [minutes, setMinutes] = useState(10);
  const [beforeApps, setBeforeApps] = useState<string[]>([]);
  const { busy, error, run } = useAction();
  const meta = KINDS.find((k) => k.kind === kind)!;

  const save = () =>
    run(async () => {
      const task = await api.addTask(kid.id, { kind, title: title.trim(), url: meta.urlHint ? url.trim() : null, requiredMinutes: minutes });
      if (beforeApps.length) await api.addRule(kid.id, { apps: beforeApps, activity: 'task', taskId: task.id, minutesRequired: Math.min(minutes, 120) });
    }).then((ok) => {
      if (!ok) return;
      setTitle('');
      setUrl('');
      setBeforeApps([]);
      onChange();
    });

  return (
    <Card>
      <Label>Tasks</Label>
      <Muted>The timer only counts while the video or audio is playing, or while {kid.name} is reading with Mello open.</Muted>
      {tasks.map((t) => (
        <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.ink, fontSize: 16, flex: 1 }}>
            {KINDS.find((k) => k.kind === t.kind)?.label}: {t.title} · {t.requiredMinutes} min {t.repeat === 'daily' ? 'daily' : 'once'}
          </Text>
          <Button title="Remove" variant="secondary" onPress={() => run(() => api.deleteTask(t.id)).then(onChange)} />
        </View>
      ))}
      <Label>New task</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {KINDS.map((k) => (
          <Chip key={k.kind} label={k.label} selected={kind === k.kind} onPress={() => setKind(k.kind)} />
        ))}
      </View>
      <Field label="Title" value={title} onChangeText={setTitle} placeholder="Fractions explained" />
      {meta.urlHint && <Field label={meta.urlHint} value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" />}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {TASK_MINUTES.map((m) => (
          <Chip key={m} label={`${m} min`} selected={minutes === m} onPress={() => setMinutes(m)} />
        ))}
      </View>
      {kid.installedApps.length > 0 && (
        <>
          <Label>Required before opening (optional)</Label>
          <AppPicker kid={kid} selected={beforeApps} onToggle={(p) => setBeforeApps((a) => (a.includes(p) ? a.filter((x) => x !== p) : [...a, p]))} />
        </>
      )}
      <ErrorText error={error} />
      <Button title="Add task" busy={busy} disabled={!title.trim() || (!!meta.urlHint && !url.trim())} onPress={save} />
    </Card>
  );
}

// ---------- Weekly insight (Nemotron 3 Ultra) ----------

export function InsightSection({ kid, api }: { kid: Kid; api: Api }) {
  const [insight, setInsight] = useState<WeeklyInsight | null>(null);
  const { busy, error, run } = useAction();
  return (
    <Card>
      <Label>Mello's read on {kid.name}'s week</Label>
      {!insight && <Muted>Mello looks at the last 7 days of reading, tasks, limits and alerts, and suggests what to try next.</Muted>}
      {insight && (
        <>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: '700' }}>{insight.headline}</Text>
          {insight.wins.map((w) => (
            <Text key={w} style={{ color: colors.good, fontSize: 15 }}>
              ✓ {w}
            </Text>
          ))}
          {insight.watch.map((w) => (
            <Text key={w} style={{ color: colors.bad, fontSize: 15 }}>
              • {w}
            </Text>
          ))}
          {insight.nextSteps.map((n) => (
            <Button key={n.text} title={n.text} variant="secondary" onPress={() => router.push({ pathname: '/parent/agent', params: { prompt: n.prompt } })} />
          ))}
          <Muted>Written by NVIDIA Nemotron on Nebius. Tap a step to ask Mello to do it.</Muted>
        </>
      )}
      <ErrorText error={error} />
      <Button title={insight ? 'Refresh' : 'Get weekly insight'} variant={insight ? 'secondary' : 'primary'} busy={busy} onPress={() => run(async () => setInsight(await api.insight(kid.id)))} />
    </Card>
  );
}

// ---------- Content ideas (Tavily search, age-checked by Nemotron) ----------

const IDEA_KINDS: { kind: ContentKind; label: string }[] = [
  { kind: 'video', label: 'Video' },
  { kind: 'article', label: 'Article' },
  { kind: 'audio', label: 'Podcast' },
];

export function ContentIdeasSection({ kid, api, onChange }: { kid: Kid; api: Api; onChange: () => void }) {
  const [topic, setTopic] = useState('');
  const [kind, setKind] = useState<ContentKind>('video');
  const [picks, setPicks] = useState<ContentPick[] | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const { busy, error, run } = useAction();
  const age = kid.settings.age ?? 9;

  const assign = (p: ContentPick) =>
    run(() => api.addTask(kid.id, { kind: p.kind, title: p.title.slice(0, 80), url: p.url, requiredMinutes: Math.min(Math.max(p.suggestedMinutes, 5), 60), repeat: 'once' })).then(
      (ok) => ok && (setAdded((a) => [...a, p.url]), onChange()),
    );

  return (
    <Card>
      <Label>Find something to learn</Label>
      <Muted>
        Mello searches the web for a topic and checks every result for a {age}-year-old before you see it. Tap one to make it a task.
      </Muted>
      <Field label="Topic" value={topic} onChangeText={setTopic} placeholder="volcanoes, fractions, kindness…" returnKeyType="search" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {IDEA_KINDS.map((k) => (
          <Chip key={k.kind} label={k.label} selected={kind === k.kind} onPress={() => setKind(k.kind)} />
        ))}
      </View>
      <ErrorText error={error} />
      <Button title="Search" busy={busy} disabled={topic.trim().length < 2} onPress={() => run(async () => setPicks(await api.contentIdeas(kid.id, topic.trim(), kind)))} />
      {picks?.length === 0 && <Muted>Nothing passed the age check. Try another topic.</Muted>}
      {picks?.map((p) => (
        <View key={p.url} style={{ gap: 4, borderTopWidth: 1, borderColor: colors.border, paddingTop: 10 }}>
          <Text style={{ color: colors.ink, fontSize: 16, fontWeight: '600' }}>{p.title}</Text>
          <Muted>{p.why}</Muted>
          <Muted>{p.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]} · about {p.suggestedMinutes} min</Muted>
          <Button
            title={added.includes(p.url) ? 'Added as a task ✓' : `Assign to ${kid.name}`}
            variant="secondary"
            disabled={added.includes(p.url) || busy}
            onPress={() => assign(p)}
          />
        </View>
      ))}
    </Card>
  );
}

// ---------- Opt-in extras ----------

const AGES = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export function SettingsSection({ kid, api, onChange }: { kid: Kid; api: Api; onChange: () => void }) {
  const { error, run } = useAction();
  const toggle = (key: 'location' | 'attentionChecks', value: boolean) => run(() => api.updateSettings(kid.id, { [key]: value })).then(onChange);
  return (
    <Card>
      <Label>{kid.name}'s age</Label>
      <Muted>Quizzes and suggested videos and articles fit this age.</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {AGES.map((a) => (
          <Chip key={a} label={String(a)} selected={kid.settings.age === a} onPress={() => run(() => api.updateSettings(kid.id, { age: a })).then(onChange)} />
        ))}
      </View>
      <Label>Extras</Label>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.ink, fontSize: 16 }}>Attention checks</Text>
          <Muted>Timers pause if the phone is face-down, muted during audio, or Mello isn't on screen.</Muted>
        </View>
        <Switch value={kid.settings.attentionChecks} onValueChange={(v) => toggle('attentionChecks', v)} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.ink, fontSize: 16 }}>Share location</Text>
          <Muted>{kid.name}'s phone asks for permission and shows that location is shared while Mello is open.</Muted>
        </View>
        <Switch value={kid.settings.location} onValueChange={(v) => toggle('location', v)} />
      </View>
      <ErrorText error={error} />
    </Card>
  );
}
