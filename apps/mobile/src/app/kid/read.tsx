import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { evaluateGate, paginate, type BookWithText, type ChallengeResult, type PublicChallenge } from '@mello/shared';
import { MelloBlocker } from '../../../modules/mello-blocker';
import { kidApi } from '@/lib/api';
import { cachedConfig } from '@/lib/kid';
import { readJson, writeJson } from '@/lib/cache';
import { SAMPLE_BOOK } from '@/lib/sampleBook';
import { useKidSession } from '@/lib/session';
import { Button, Card, colors, Label, Muted } from '@/components/ui';

/** Reading time only counts while the kid is actually turning pages or scrolling. */
const IDLE_AFTER_MS = 90_000;
/** Extra reading required after a missed quiz. */
const RETRY_SECONDS = 60;

type Progress = Record<string, number>;

export default function Read() {
  const { gate } = useLocalSearchParams<{ gate?: string }>();
  const session = useKidSession();
  const api = useMemo(() => kidApi(session.token), [session.token]);
  const config = useMemo(() => cachedConfig(), []);

  const [book, setBook] = useState<BookWithText | null>(null);
  const pages = useMemo(() => (book ? paginate(book.text) : []), [book]);
  const [page, setPage] = useState(0);
  const startPage = useRef(0);

  // What the gate asks for, decided once when the screen opens.
  const decision = useMemo(() => (gate && config ? evaluateGate(config.rules, gate, MelloBlocker.getUnlocks()) : null), [gate, config]);
  const rule = decision?.blocked && decision.reason === 'rule' ? decision.rule : null;
  const appLabel = config?.kid.installedApps.find((a) => a.packageName === gate)?.label ?? gate;
  const [requiredSeconds, setRequiredSeconds] = useState(() => (rule ? rule.minutesRequired * 60 : 0));

  const [seconds, setSeconds] = useState(0);
  const lastActivity = useRef(Date.now());
  const [idle, setIdle] = useState(false);
  const logged = useRef(false);

  const [quiz, setQuiz] = useState<PublicChallenge | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<ChallengeResult | null>(null);
  const [quizBusy, setQuizBusy] = useState(false);

  // If the app is already unlocked (or never needed a gate), just go.
  useEffect(() => {
    if (gate && decision && !decision.blocked) {
      MelloBlocker.launchApp(gate);
      router.back();
    }
  }, [gate, decision]);

  // Load the assigned book (cached for offline), falling back to the built-in sample.
  useEffect(() => {
    const id = config?.currentBook?.id;
    const saved = readJson<Progress>('progress', {});
    const open = (b: BookWithText) => {
      setBook(b);
      const p = Math.min(saved[b.id] ?? 0, Math.max(paginate(b.text).length - 1, 0));
      setPage(p);
      startPage.current = p;
    };
    if (!id) return open(SAMPLE_BOOK);
    const cached = readJson<BookWithText | null>(`book-${id}`, null);
    if (cached) open(cached);
    api
      .book(id)
      .then((b) => {
        writeJson(`book-${id}`, b);
        if (!cached) open(b);
      })
      .catch(() => !cached && open(SAMPLE_BOOK));
  }, [api, config]);

  // Reading clock: ticks only while Mello is in the foreground and the kid has been active recently.
  useEffect(() => {
    const t = setInterval(() => {
      const active = AppState.currentState === 'active' && Date.now() - lastActivity.current < IDLE_AFTER_MS;
      setIdle(!active);
      if (active && !quiz) setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [quiz]);

  const touch = () => {
    lastActivity.current = Date.now();
    if (idle) setIdle(false);
  };

  const turn = (delta: number) => {
    touch();
    setPage((p) => {
      const next = Math.max(0, Math.min(pages.length - 1, p + delta));
      if (book) writeJson('progress', { ...readJson<Progress>('progress', {}), [book.id]: next });
      return next;
    });
  };

  const logSession = useCallback(
    (extra: { challengeId?: string; passed?: boolean } = {}) => {
      if (logged.current || seconds < 5) return;
      logged.current = true;
      api
        .logSession({
          bookId: book && book.id !== SAMPLE_BOOK.id ? book.id : undefined,
          seconds,
          fromPage: startPage.current,
          toPage: page,
          appPackage: gate,
          ...extra,
        })
        .catch(() => {});
    },
    [api, book, gate, page, seconds],
  );

  // Plain reading (no gate): record the session when leaving.
  const logRef = useRef(logSession);
  logRef.current = logSession;
  useEffect(() => () => logRef.current(), []);

  const unlockAndGo = (challengeId?: string) => {
    if (!gate || !rule) return;
    MelloBlocker.unlock(gate, rule.unlockMinutes);
    logSession({ challengeId, passed: true });
    MelloBlocker.launchApp(gate);
    router.back();
  };

  const startQuiz = async () => {
    setQuizBusy(true);
    setResult(null);
    setAnswers([]);
    const passage = pages.slice(Math.min(startPage.current, page), page + 1).join('\n\n');
    try {
      setQuiz(await api.challenge(book && book.id !== SAMPLE_BOOK.id ? book.id : null, passage.length >= 100 ? passage : pages.slice(0, page + 1).join('\n\n')));
    } catch (err) {
      // Offline or the AI is down: the reading time alone is enough, so a kid is never stuck.
      console.warn('[quiz] unavailable, unlocking on time only', err);
      unlockAndGo();
    } finally {
      setQuizBusy(false);
    }
  };

  const submit = async () => {
    if (!quiz) return;
    setQuizBusy(true);
    try {
      const r = await api.answer(quiz.challengeId, answers);
      setResult(r);
      if (r.passed) setTimeout(() => unlockAndGo(quiz.challengeId), 1500);
    } catch {
      unlockAndGo(quiz.challengeId);
    } finally {
      setQuizBusy(false);
    }
  };

  const tryAgain = () => {
    setQuiz(null);
    setResult(null);
    setRequiredSeconds((r) => Math.max(r, seconds) + RETRY_SECONDS);
    touch();
  };

  const remaining = Math.max(0, requiredSeconds - seconds);
  const done = !!rule && remaining === 0;
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  if (quiz) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Quick quiz' }} />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          {quiz.questions.map((q, qi) => (
            <Card key={qi}>
              <Label>{q.question}</Label>
              {q.choices.map((choice, ci) => {
                const chosen = answers[qi] === ci;
                const correct = result?.correctAnswers[qi] === ci;
                const bg = result ? (correct ? '#DDF5E6' : chosen ? '#FBE1E1' : colors.card) : chosen ? '#E4E4FB' : colors.card;
                return (
                  <Pressable
                    key={ci}
                    disabled={!!result}
                    onPress={() => setAnswers((a) => Object.assign([...a], { [qi]: ci }))}
                    style={{ backgroundColor: bg, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: chosen ? colors.primary : colors.border }}
                  >
                    <Text style={{ fontSize: 16, color: colors.ink }}>{choice}</Text>
                  </Pressable>
                );
              })}
            </Card>
          ))}
          {!result && (
            <Button
              title="Check my answers"
              busy={quizBusy}
              disabled={quiz.questions.some((_, i) => answers[i] === undefined)}
              onPress={submit}
            />
          )}
          {result?.passed && <Label>🎉 {result.correct} of {result.total} right! Opening {appLabel}…</Label>}
          {result && !result.passed && (
            <>
              <Label>
                {result.correct} of {result.total} right. Read one more minute and try again. You've got this!
              </Label>
              <Button title="Keep reading" onPress={tryAgain} />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <Stack.Screen options={{ title: book?.title ?? 'Reading' }} />

      {rule && (
        <View style={{ padding: 12, backgroundColor: done ? '#DDF5E6' : '#E4E4FB', gap: 8 }}>
          <Label>{done ? `Nice reading! Answer a quick quiz to open ${appLabel}.` : `Read ${mmss(remaining)} more to open ${appLabel}`}</Label>
          {done && <Button title="Take the quiz" busy={quizBusy} onPress={startQuiz} />}
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: 20 }} onScroll={touch} scrollEventThrottle={2000}>
        <Text style={{ fontSize: 20, lineHeight: 32, color: colors.ink }}>{pages[page] ?? ''}</Text>
      </ScrollView>

      {idle && (
        <Pressable onPress={touch} style={{ padding: 12, backgroundColor: '#FFF1C2' }}>
          <Text style={{ textAlign: 'center', color: colors.ink }}>Still reading? Tap here — the timer is paused.</Text>
        </Pressable>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 }}>
        <View style={{ flex: 1 }}>
          <Button title="‹ Back" variant="secondary" disabled={page === 0} onPress={() => turn(-1)} />
        </View>
        <Muted>
          {pages.length ? page + 1 : 0} / {pages.length}
        </Muted>
        <View style={{ flex: 1 }}>
          <Button title="Next ›" disabled={page >= pages.length - 1} onPress={() => turn(1)} />
        </View>
      </View>
    </SafeAreaView>
  );
}
