import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuleInput, TaskInput, type InstalledApp, type PublicChallenge, type UsageDay } from '@mello/shared';
import type { Repo } from './repo.ts';
import { generateChallenge, grade } from './challenge.ts';
import { reflectionQuestions, runCoach, streakOf } from './coach.ts';
import { runLiveTest, type LiveTestResult } from './liveTest.ts';
import { newToken } from './db.ts';

/**
 * Public, no-login demo for judges and visitors (mounted at /demo when DEMO=1). Each visitor gets a
 * sandbox "Just me" phone that lives for two hours, with real Nemotron calls for Mello's chat, the
 * reading quiz and reflection. Nothing about the visitor is collected.
 */

const PAGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo.html');
const TTL_MS = 2 * 60 * 60_000;
const MAX_SANDBOXES = 200;

const APPS: InstalledApp[] = [
  { packageName: 'com.instagram.android', label: 'Instagram', category: 'social' },
  { packageName: 'com.zhiliaoapp.musically', label: 'TikTok', category: 'social' },
  { packageName: 'com.google.android.youtube', label: 'YouTube', category: 'video' },
  { packageName: 'org.readera', label: 'ReadEra', category: 'reading' },
  { packageName: 'com.audible.application', label: 'Audible', category: 'audio' },
];

type Sandbox = { userId: string; subjectId: string; familyId: string; createdAt: number };

export type DemoOptions = { now?: () => number; limits?: { llmPerWindow: number; sessionsPerWindow: number; windowMs: number } };

export function demoRouter(repo: Repo, opts: DemoOptions = {}) {
  const now = opts.now ?? Date.now;
  const limits = opts.limits ?? { llmPerWindow: 20, sessionsPerWindow: 5, windowMs: 10 * 60_000 };
  const sandboxes = new Map<string, Sandbox>();
  const hits = new Map<string, number[]>();
  let liveCache: { at: number; result: LiveTestResult } | null = null;

  const ip = (c: Context) => c.req.header('fly-client-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  /** Sliding-window limit per visitor and kind. */
  const limit = (c: Context, kind: 'llm' | 'session') => {
    const key = `${kind}:${ip(c)}`;
    const max = kind === 'llm' ? limits.llmPerWindow : limits.sessionsPerWindow;
    const t = now();
    const recent = (hits.get(key) ?? []).filter((x) => t - x < limits.windowMs);
    if (recent.length >= max) {
      throw new HTTPException(429, { message: kind === 'llm' ? 'Mello needs a short break. Try again in a few minutes.' : 'Too many demo sessions from here. Try again later.' });
    }
    recent.push(t);
    hits.set(key, recent);
  };
  const sweep = async () => {
    const t = now();
    for (const [token, s] of sandboxes) {
      if (t - s.createdAt > TTL_MS) {
        sandboxes.delete(token);
        await repo.deleteSandbox(s.userId).catch(() => {});
      }
    }
  };
  const sandbox = (c: Context) => {
    const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const s = sandboxes.get(token);
    if (!s || now() - s.createdAt > TTL_MS) throw new HTTPException(401, { message: 'Demo session expired. Reload the page.' });
    return s;
  };
  const body = async <T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> => {
    const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) throw new HTTPException(400, { message: z.prettifyError(parsed.error) });
    return parsed.data;
  };
  const day = (offset = 0) => {
    const d = new Date(now() - offset * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  async function state(s: Sandbox) {
    const [kid, tasks, rules, limitsList, quiet, usage, progress, profile] = await Promise.all([
      repo.getKid(s.familyId, s.subjectId),
      repo.listTasks(s.subjectId, true),
      repo.listRules(s.subjectId),
      repo.listLimits(s.subjectId),
      repo.getQuietHours(s.subjectId),
      repo.usageDays(s.subjectId, 7),
      repo.taskProgress(s.subjectId, day()),
      repo.selfProfile(s.userId),
    ]);
    return {
      name: kid?.name ?? 'Sam',
      apps: APPS,
      goals: tasks.map((t) => ({ ...t, progress: progress.find((p) => p.taskId === t.id) ?? null })),
      rules,
      limits: limitsList,
      bedtime: quiet,
      interests: profile?.interests ?? [],
      usage,
      streak: streakOf(usage, day()),
    };
  }

  const demo = new Hono();

  demo.get('/', async (c) => c.html(await readFile(PAGE, 'utf8')));

  /** Starts a sandbox phone with a week of believable history and one goal. */
  demo.post('/session', async (c) => {
    limit(c, 'session');
    await sweep();
    if (sandboxes.size >= MAX_SANDBOXES) throw new HTTPException(503, { message: 'The demo is busy right now. Try again in a minute.' });
    const userId = randomUUID();
    const { subjectId } = await repo.setupSelf(userId, 'Sam');
    const profile = (await repo.selfProfile(userId))!;
    await repo.updateDevice(subjectId, { installedApps: APPS });
    const task = await repo.addTask(profile.familyId, subjectId, TaskInput.parse({ kind: 'app', title: '10 min in ReadEra', appPackage: 'org.readera', requiredMinutes: 10 }));
    await repo.addRule(subjectId, RuleInput.parse({ apps: ['com.instagram.android'], activity: 'task', taskId: task.id, minutesRequired: 10, unlockMinutes: 30 }));
    // A week that tells a story: heavy social early on, reading creeping up, guard on every day.
    const social = [118, 104, 96, 88, 71, 64];
    const reading = [0, 6, 10, 12, 14, 18];
    for (let i = 6; i >= 1; i--) {
      const k = 6 - i;
      const u: UsageDay = {
        day: day(i),
        apps: [
          { packageName: 'com.instagram.android', label: 'Instagram', category: 'social', minutes: Math.round(social[k]! * 0.6), opens: 40 - k * 3 },
          { packageName: 'com.zhiliaoapp.musically', label: 'TikTok', category: 'social', minutes: Math.round(social[k]! * 0.4), opens: 22 - k * 2 },
          { packageName: 'org.readera', label: 'ReadEra', category: 'reading', minutes: reading[k]!, opens: reading[k] ? 2 : 0 },
        ],
        categories: { social: social[k]!, reading: reading[k]!, video: 25, audio: k > 2 ? 15 : 0 },
        unlocks: 95 - k * 6,
        guardOn: 1,
        focusMinutes: reading[k]!,
        breakGlass: k === 1 ? 1 : 0,
        goalMet: reading[k]! >= 10,
      };
      await repo.putUsageDay(subjectId, u);
    }
    const token = newToken();
    const sb: Sandbox = { userId, subjectId, familyId: profile.familyId, createdAt: now() };
    sandboxes.set(token, sb);
    return c.json({ token, state: await state(sb) }, 201);
  });

  demo.get('/state', async (c) => c.json(await state(sandbox(c))));

  /** Talk to Mello: real Nemotron tool calling against the sandbox phone. */
  demo.post('/coach', async (c) => {
    const s = sandbox(c);
    const { messages } = await body(c, z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(600) })).min(1).max(16) }));
    limit(c, 'llm');
    const profile = (await repo.selfProfile(s.userId))!;
    const subject = (await repo.getKid(s.familyId, s.subjectId))!;
    const { familyId: _f, revoked: _r, ...pub } = profile;
    const res = await runCoach(repo, { userId: s.userId, familyId: s.familyId, subject, profile: pub }, messages);
    return c.json({ ...res, state: await state(s) });
  });

  /** A quiz on the passage just read. Answers stay on the server. */
  demo.post('/quiz', async (c) => {
    const s = sandbox(c);
    const { passage } = await body(c, z.object({ passage: z.string().min(100).max(6000) }));
    limit(c, 'llm');
    const generated = await generateChallenge(passage, null);
    const challengeId = await repo.saveChallenge(s.subjectId, null, generated);
    const pub: PublicChallenge = { challengeId, questions: generated.questions.map(({ question, choices }) => ({ question, choices })) };
    return c.json(pub, 201);
  });

  /** Grades the quiz; a pass completes today's reading goal and unlocks Instagram. */
  demo.post('/quiz/:id/answers', async (c) => {
    const s = sandbox(c);
    const { answers, seconds } = await body(c, z.object({ answers: z.array(z.number().int().min(0).max(3)).max(3), seconds: z.number().int().min(0).max(3600).default(600) }));
    const stored = await repo.getChallenge(s.subjectId, c.req.param('id'));
    if (!stored) throw new HTTPException(404, { message: 'Quiz not found' });
    if (stored.result) throw new HTTPException(409, { message: 'Already answered' });
    const result = grade(stored.challenge, answers);
    await repo.setChallengeResult(c.req.param('id'), result);
    const goal = (await repo.listTasks(s.subjectId, true)).find((t) => t.kind === 'app');
    if (result.passed && goal) {
      for (let left = goal.requiredMinutes * 60; left > 0; left -= 300) await repo.addTaskProgress(s.subjectId, goal.id, day(), Math.min(300, left));
    }
    await repo.addSession(s.subjectId, { taskId: goal?.id, seconds, appPackage: 'com.instagram.android', challengeId: c.req.param('id'), passed: result.passed });
    return c.json({ result, state: await state(s) });
  });

  demo.post('/reflect', async (c) => {
    const s = sandbox(c);
    const { title, minutes } = await body(c, z.object({ title: z.string().trim().max(120).nullable().default(null), minutes: z.number().int().min(1).max(600).default(10) }));
    limit(c, 'llm');
    const profile = (await repo.selfProfile(s.userId))!;
    const { familyId: _f, revoked: _r, ...pub } = profile;
    return c.json({ questions: await reflectionQuestions(pub, { appLabel: 'ReadEra', title, minutes }) });
  });

  /** Live check of the AI path on Nebius Token Factory. Cached for a minute so it can't be used to burn tokens. */
  demo.get('/live-test', async (c) => {
    if (!liveCache || now() - liveCache.at > 60_000) {
      limit(c, 'llm');
      liveCache = { at: now(), result: await runLiveTest() };
    }
    return c.json({ ...liveCache.result, cached: now() - liveCache.at > 1000 });
  });

  return demo;
}
