import { useEffect, useMemo, useState } from 'react';
import { Redirect, router } from 'expo-router';
import { characterLine } from '@mello/shared';
import type { FocusResult } from '../../../modules/mello-blocker';
import { MelloBlocker } from '../../../modules/mello-blocker';
import { selfApi } from '@/lib/api';
import { readJson, writeJson } from '@/lib/cache';
import { cachedConfig } from '@/lib/kid';
import { recordFocus } from '@/lib/self';
import { useSelfSession } from '@/lib/session';
import { speakAs } from '@/lib/voice';
import { CharacterSays } from '@/components/Character';
import { Button, Card, Field, Label, Muted, Screen } from '@/components/ui';

/**
 * After a focus session: record it, then (if it was completed) a couple of open questions from the
 * character about what you read or heard. No grading; skipping is fine.
 */
export default function Reflect() {
  const session = useSelfSession();
  const config = useMemo(() => cachedConfig(), []);
  const prefs = config?.kid.settings.character;
  const result = useMemo(() => readJson<FocusResult | null>('last-focus-result', null), []);
  const minutes = result ? Math.max(1, Math.round(result.elapsedMs / 60_000)) : 0;

  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Record once, whatever the user does next.
  useEffect(() => {
    if (!result) return;
    recordFocus(session.token, config, result).catch((e) => console.warn('[focus] record failed', e));
    writeJson('last-focus-result', null);
    if (result.completed && prefs?.voiceOn !== false) speakAs(prefs, characterLine(prefs, 'focus_done', { minutes }));
  }, [result, session.token, config, prefs, minutes]);

  const done = () => {
    if (result?.completed && result.gatedApp) MelloBlocker.launchApp(result.gatedApp);
    router.replace('/self');
  };

  if (!result) return <Redirect href="/self" />;

  if (!result.completed) {
    return (
      <Screen>
        <CharacterSays prefs={prefs} mood="sleepy" text={characterLine(prefs, 'break_glass', { minutes })} />
        <Muted>
          {result.reason === 'app_missing' ? `${result.label} isn't on your phone any more, so I stopped.` : `You spent ${minutes} min in ${result.label} this time.`}
        </Muted>
        <Button title="OK" onPress={() => router.replace('/self')} />
      </Screen>
    );
  }

  const ask = async () => {
    setBusy(true);
    try {
      const { questions: qs } = await selfApi().reflect({ appLabel: result.label, title: title.trim() || null, minutes });
      setQuestions(qs);
      setAnswers(qs.map(() => ''));
    } catch {
      setQuestions(['What stayed with you?']);
      setAnswers(['']);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const r = await selfApi().saveReflection({ title: title.trim() || null, questions: questions ?? [], answers });
      setReply(r.reply ?? characterLine(prefs, 'focus_done', { minutes }));
    } catch {
      setReply(characterLine(prefs, 'focus_done', { minutes }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <CharacterSays prefs={prefs} mood="proud" text={reply ?? characterLine(prefs, 'focus_done', { minutes })} />
      {!reply && !questions && (
        <Card>
          <Field label={`What were you reading or listening to in ${result.label}? (optional)`} value={title} onChangeText={setTitle} placeholder="Book, podcast, chapter…" />
          <Button title="Reflect for a minute" busy={busy} onPress={ask} />
          <Button title={result.gatedApp ? 'Skip and continue' : 'Skip'} variant="secondary" onPress={done} />
        </Card>
      )}
      {!reply && questions && (
        <Card>
          {questions.map((q, i) => (
            <Field
              key={q}
              label={q}
              value={answers[i] ?? ''}
              onChangeText={(t) => setAnswers((a) => a.map((x, j) => (j === i ? t : x)))}
              multiline
              style={{ minHeight: 70, textAlignVertical: 'top' }}
            />
          ))}
          <Button title="Save" busy={busy} onPress={submit} />
          <Button title="Skip" variant="secondary" onPress={done} />
        </Card>
      )}
      {reply && (
        <>
          <Label>Saved.</Label>
          <Button title={result.gatedApp ? 'Continue' : 'Done'} onPress={done} />
        </>
      )}
    </Screen>
  );
}
