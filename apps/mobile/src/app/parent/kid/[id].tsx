import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import type { Book, Kid, Rule } from '@mello/shared';
import { parentApi, type Report } from '@/lib/api';
import { useParentSession } from '@/lib/session';
import { Button, Card, Chip, ErrorText, Field, Label, Muted, Screen, Title } from '@/components/ui';

const MINUTE_OPTIONS = [1, 2, 5, 10, 15];
const UNLOCK_OPTIONS = [15, 30, 60];

export default function KidDetail() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const session = useParentSession();
  const api = useMemo(() => parentApi(session.token), [session.token]);

  const [kid, setKid] = useState<Kid | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const [kids, r, b, rep] = await Promise.all([api.kids(), api.rules(id), api.books(), api.report(id)]);
      setKid(kids.find((k) => k.id === id) ?? null);
      setRules(r);
      setBooks(b);
      setReport(rep);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [api, id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const appLabel = (pkg: string) => kid?.installedApps.find((a) => a.packageName === pkg)?.label ?? pkg;

  return (
    <Screen>
      <Stack.Screen options={{ title: kid?.name ?? name ?? 'Kid' }} />
      <ErrorText error={error} />

      {report && (
        <Card>
          <Label>Last 7 days</Label>
          <Muted>
            {report.minutesRead} minutes read · {report.challengesPassed} quizzes passed · {report.challengesFailed} missed
          </Muted>
        </Card>
      )}

      <Title>Reading rules</Title>
      {rules.length === 0 && <Muted>No rules yet. Every app opens freely.</Muted>}
      {rules.map((r) => (
        <Card key={r.id}>
          <Label>
            Read {r.minutesRequired} min → open {r.apps.map(appLabel).join(', ')}
          </Label>
          <Muted>Stays unlocked for {r.unlockMinutes} min</Muted>
          <Button title="Delete rule" variant="secondary" onPress={() => api.deleteRule(r.id).then(load).catch(setError)} />
        </Card>
      ))}
      {kid && <NewRule kid={kid} onSave={(input) => api.addRule(kid.id, input).then(load)} />}

      <Title>Book</Title>
      {books.length === 0 && <Muted>Add a book in the Books screen first.</Muted>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {books.map((b) => (
          <Chip key={b.id} label={b.title} selected={kid?.currentBookId === b.id} onPress={() => api.assignBook(id, b.id).then(load).catch(setError)} />
        ))}
      </View>

      <Title>Message</Title>
      <SendMessage kidId={id} api={api} />
    </Screen>
  );
}

function NewRule({ kid, onSave }: { kid: Kid; onSave: (input: { apps: string[]; minutesRequired: number; unlockMinutes: number }) => Promise<unknown> }) {
  const [apps, setApps] = useState<string[]>([]);
  const [minutes, setMinutes] = useState(5);
  const [unlock, setUnlock] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toggle = (pkg: string) => setApps((a) => (a.includes(pkg) ? a.filter((p) => p !== pkg) : [...a, pkg]));

  if (kid.installedApps.length === 0)
    return (
      <Card>
        <Muted>Open Mello on {kid.name}'s phone once so it can share the list of apps.</Muted>
      </Card>
    );

  return (
    <Card>
      <Label>New rule: which apps need reading first?</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {kid.installedApps.map((a) => (
          <Chip key={a.packageName} label={a.label} selected={apps.includes(a.packageName)} onPress={() => toggle(a.packageName)} />
        ))}
      </View>
      <Label>Minutes of reading</Label>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {MINUTE_OPTIONS.map((m) => (
          <Chip key={m} label={`${m}`} selected={minutes === m} onPress={() => setMinutes(m)} />
        ))}
      </View>
      <Label>Then unlocked for</Label>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {UNLOCK_OPTIONS.map((m) => (
          <Chip key={m} label={`${m} min`} selected={unlock === m} onPress={() => setUnlock(m)} />
        ))}
      </View>
      <ErrorText error={error} />
      <Button
        title="Save rule"
        busy={busy}
        disabled={apps.length === 0}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            await onSave({ apps, minutesRequired: minutes, unlockMinutes: unlock });
            setApps([]);
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Card>
  );
}

function SendMessage({ kidId, api }: { kidId: string; api: ReturnType<typeof parentApi> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder);

  useEffect(() => {
    requestRecordingPermissionsAsync().then((p) => {
      if (p.granted) setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    });
  }, []);

  const send = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      Alert.alert('Sent', 'It will play on their phone.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Field label="Type a message (read aloud on their phone)" value={text} onChangeText={setText} multiline placeholder="Great job reading today!" />
      <Button
        title="Send spoken message"
        busy={busy}
        disabled={!text.trim()}
        onPress={() =>
          send(async () => {
            await api.sendText(kidId, text.trim());
            setText('');
          })
        }
      />
      <Label>Or record your voice</Label>
      <Button
        title={state.isRecording ? `Stop and send (${Math.round(state.durationMillis / 1000)}s)` : 'Record'}
        variant={state.isRecording ? 'danger' : 'secondary'}
        busy={busy}
        onPress={async () => {
          if (!state.isRecording) {
            await recorder.prepareToRecordAsync();
            recorder.record();
            return;
          }
          await recorder.stop();
          if (recorder.uri) send(() => api.sendAudio(kidId, recorder.uri!));
        }}
      />
      <ErrorText error={error} />
    </Card>
  );
}
