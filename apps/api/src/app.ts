import OpenAI from 'openai';
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AppLimit,
  BookInput,
  CharacterPrefs,
  DeviceStatus,
  InstalledApp,
  KidSettings,
  QuietHours,
  RuleInput,
  SelfProfileInput,
  TaskInput,
  UsageDay,
  type KidConfig,
  type PublicChallenge,
} from '@mello/shared';
import type { Db } from './db.ts';
import { NotFound, Repo } from './repo.ts';
import { generateChallenge, grade } from './challenge.ts';
import { runAgent } from './agent.ts';
import { reflectionQuestions, reflectionReply, runCoach, streakOf } from './coach.ts';
import { sendPush } from './push.ts';
import { LlmUnavailableError, MODELS } from './llm.ts';
import { findKidContent, searchEnabled, SearchUnavailableError } from './tavily.ts';
import { weeklyInsight } from './insight.ts';
import type { VerifyParentToken } from './auth.ts';

type ParentEnv = { Variables: { userId: string; familyId: string | null } };
type KidEnv = { Variables: { kidId: string; familyId: string } };

/** HTTPException plus a machine-readable code the phone can branch on. */
class CodedError extends HTTPException {
  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 429,
    message: string,
    readonly code: string,
  ) {
    super(status, { message });
  }
}

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './data/audio';
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD');

export function createApp(db: Db, opts: { verifyParentToken: VerifyParentToken }) {
  const repo = new Repo(db);
  const app = new Hono();

  const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const parentAuth = createMiddleware<ParentEnv>(async (c, next) => {
    const userId = await opts.verifyParentToken(bearer(c));
    if (!userId) throw new CodedError(401, 'Please sign in again', 'parent_unauthorized');
    c.set('userId', userId);
    c.set('familyId', (await repo.familyForUser(userId))?.id ?? null);
    await next();
  });
  /** The signed-in parent's family; a parent who hasn't created one yet gets a clear code. */
  const fam = (c: Context<ParentEnv>) => {
    const id = c.get('familyId');
    if (!id) throw new CodedError(404, 'Create your family first', 'no_family');
    return id;
  };
  const kidAuth = createMiddleware<KidEnv>(async (c, next) => {
    const kid = await repo.kidByToken(bearer(c));
    if (!kid) throw new HTTPException(401, { message: 'Device token required' });
    if (kid.revoked_at) throw new CodedError(401, 'This phone was signed out of Mello', 'device_unpaired');
    c.set('kidId', kid.id);
    c.set('familyId', kid.family_id);
    await next();
  });
  const body = async <T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> => {
    const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) throw new HTTPException(400, { message: z.prettifyError(parsed.error) });
    return parsed.data;
  };
  const baseUrl = (c: Context) => process.env.PUBLIC_URL ?? new URL(c.req.url).origin;
  const saveAudio = async (file: File) => {
    if (file.size > MAX_AUDIO_BYTES) throw new HTTPException(413, { message: 'Audio file is too large (25 MB max)' });
    const ext = (file.name.split('.').pop() ?? 'm4a').replace(/[^a-z0-9]/gi, '').slice(0, 5).toLowerCase() || 'm4a';
    const fileName = `${randomUUID()}.${ext}`;
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(join(UPLOAD_DIR, fileName), Buffer.from(await file.arrayBuffer()));
    return fileName;
  };

  app.onError((err, c) => {
    if (err instanceof CodedError) return c.json({ error: err.message, code: err.code }, err.status);
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof NotFound) return c.json({ error: err.message }, 404);
    // Malformed UUID in a path or body: treat as "not found" rather than a server error.
    if ((err as any)?.code === '22P02') return c.json({ error: 'Not found' }, 404);
    if (err instanceof LlmUnavailableError) return c.json({ error: err.message, code: 'llm_unavailable' }, 503);
    if (err instanceof SearchUnavailableError) return c.json({ error: err.message, code: 'search_unavailable' }, 503);
    // Token Factory refused or failed (bad key, no access to the model, outage): the phone falls back to time-only.
    if (err instanceof OpenAI.APIError) {
      console.error(`[llm] ${err.status} ${err.message}`);
      return c.json({ error: `AI service error (${err.status ?? 'network'})`, code: 'llm_unavailable' }, 503);
    }
    console.error(err);
    return c.json({ error: 'Internal error' }, 500);
  });

  app.get('/health', (c) => c.json({ ok: true, ai: { provider: 'Nebius Token Factory', models: MODELS }, webSearch: searchEnabled() ? 'tavily' : null }));

  app.post('/pair', async (c) => {
    const { code, kidName } = await body(c, z.object({ code: z.string().regex(/^\d{6}$/), kidName: z.string().trim().min(1).max(40) }));
    const kid = await repo.pairKid(code, kidName);
    if (!kid) throw new HTTPException(404, { message: 'Pairing code not found' });
    return c.json({ kidId: kid.id, deviceToken: kid.deviceToken }, 201);
  });

  // ---------- Parent (Supabase Auth user) ----------
  const parent = new Hono<ParentEnv>().use(parentAuth);
  const kidParam = async (c: Context<ParentEnv>) => {
    const kid = await repo.getKid(fam(c), c.req.param('kidId')!);
    if (!kid) throw new HTTPException(404, { message: 'Kid not found' });
    return kid;
  };
  const notifyKid = async (kidId: string, kind: Parameters<typeof sendPush>[1], note?: { title: string; body: string }) =>
    sendPush(await repo.pushToken(kidId), kind, note);

  parent.get('/family', async (c) => {
    const f = await repo.familyForUser(c.get('userId'));
    if (!f) throw new CodedError(404, 'Create your family first', 'no_family');
    return c.json({ id: f.id, name: f.name, pairingCode: f.pairing_code, hasPassword: f.has_password });
  });
  parent.post('/family', async (c) => {
    if (c.get('familyId')) throw new CodedError(409, 'You already have a family', 'family_exists');
    const { name } = await body(c, z.object({ name: z.string().trim().min(1).max(60) }));
    const f = await repo.createFamily(c.get('userId'), name);
    return c.json({ id: f.id, name: f.name, pairingCode: f.pairing_code, hasPassword: f.has_password }, 201);
  });

  // Password a kid's phone must enter to sign out. A PIN is fine; the phone side is rate-limited.
  parent.put('/password', async (c) => {
    const { password } = await body(c, z.object({ password: z.string().min(4).max(100) }));
    await repo.setParentPassword(fam(c), password);
    return c.json({ ok: true });
  });
  parent.get('/unpair-requests', async (c) => c.json(await repo.pendingUnpairRequests(fam(c))));
  parent.post('/unpair-requests/:id', async (c) => {
    const { approve } = await body(c, z.object({ approve: z.boolean() }));
    if (!(await repo.decideUnpairRequest(fam(c), c.req.param('id'), approve)))
      throw new HTTPException(404, { message: 'Request not found or already decided' });
    return c.json({ ok: true });
  });

  parent.get('/kids', async (c) => c.json(await repo.listKids(fam(c))));
  parent.patch('/kids/:kidId/settings', async (c) => {
    const kid = await kidParam(c);
    const updated = await repo.updateSettings(fam(c), kid.id, await body(c, KidSettings.partial()));
    await notifyKid(kid.id, 'rules-changed');
    return c.json(updated);
  });
  parent.get('/kids/:kidId/location', async (c) => c.json(await repo.lastLocation((await kidParam(c)).id)));

  parent.get('/kids/:kidId/rules', async (c) => c.json(await repo.listRules((await kidParam(c)).id)));
  parent.post('/kids/:kidId/rules', async (c) => {
    const kid = await kidParam(c);
    const rule = await repo.addRule(kid.id, await body(c, RuleInput));
    await notifyKid(kid.id, 'rules-changed');
    return c.json(rule, 201);
  });
  parent.delete('/rules/:ruleId', async (c) => {
    if (!(await repo.deleteRule(fam(c), c.req.param('ruleId')))) throw new HTTPException(404, { message: 'Rule not found' });
    return c.body(null, 204);
  });

  parent.get('/kids/:kidId/tasks', async (c) => c.json(await repo.listTasks((await kidParam(c)).id)));
  parent.post('/kids/:kidId/tasks', async (c) => {
    const kid = await kidParam(c);
    const task = await repo.addTask(fam(c), kid.id, await body(c, TaskInput));
    await notifyKid(kid.id, 'rules-changed', { title: 'New task', body: task.title });
    return c.json(task, 201);
  });
  parent.delete('/tasks/:taskId', async (c) => {
    if (!(await repo.deleteTask(fam(c), c.req.param('taskId')))) throw new HTTPException(404, { message: 'Task not found' });
    return c.body(null, 204);
  });

  parent.get('/kids/:kidId/limits', async (c) => c.json(await repo.listLimits((await kidParam(c)).id)));
  parent.put('/kids/:kidId/limits', async (c) => {
    const kid = await kidParam(c);
    await repo.setLimit(kid.id, await body(c, AppLimit));
    await notifyKid(kid.id, 'rules-changed');
    return c.json(await repo.listLimits(kid.id));
  });
  parent.delete('/kids/:kidId/limits/:packageName', async (c) => {
    const kid = await kidParam(c);
    if (!(await repo.deleteLimit(kid.id, c.req.param('packageName')))) throw new HTTPException(404, { message: 'Limit not found' });
    await notifyKid(kid.id, 'rules-changed');
    return c.body(null, 204);
  });
  parent.get('/kids/:kidId/quiet-hours', async (c) => c.json(await repo.getQuietHours((await kidParam(c)).id)));
  parent.put('/kids/:kidId/quiet-hours', async (c) => {
    const kid = await kidParam(c);
    await repo.setQuietHours(kid.id, await body(c, QuietHours));
    await notifyKid(kid.id, 'rules-changed');
    return c.json(await repo.getQuietHours(kid.id));
  });

  parent.put('/kids/:kidId/book', async (c) => {
    const kid = await kidParam(c);
    const { bookId } = await body(c, z.object({ bookId: z.string() }));
    if (!(await repo.setCurrentBook(fam(c), kid.id, bookId))) throw new HTTPException(404, { message: 'Book not found' });
    await notifyKid(kid.id, 'book-assigned', { title: 'New book!', body: 'You have a new book to read in Mello.' });
    return c.json({ ok: true });
  });
  parent.get('/kids/:kidId/report', async (c) => c.json(await repo.report((await kidParam(c)).id, Number(c.req.query('days') ?? 7))));
  /** Nemotron 3 Ultra's read of the kid's week. Slow (tens of seconds), so the app asks for it on demand. */
  parent.get('/kids/:kidId/insight', async (c) => c.json(await weeklyInsight(repo, fam(c), await kidParam(c))));
  /** Tavily search + Nemotron age screen: links a parent can turn into a task with one tap. */
  parent.post('/kids/:kidId/content-ideas', async (c) => {
    const kid = await kidParam(c);
    const { topic, kind } = await body(c, z.object({ topic: z.string().trim().min(2).max(100), kind: z.enum(['video', 'article', 'audio']).default('video') }));
    return c.json(await findKidContent(topic, kind, kid.settings.age ?? 9));
  });
  parent.get('/kids/:kidId/messages', async (c) => c.json(await repo.listMessages((await kidParam(c)).id, baseUrl(c), false)));

  parent.get('/books', async (c) => c.json(await repo.listBooks(fam(c))));
  parent.post('/books', async (c) => {
    const input = await body(c, BookInput.extend({ source: z.enum(['pasted', 'file', 'sample']).optional() }));
    return c.json(await repo.addBook(fam(c), input), 201);
  });

  parent.get('/alerts', async (c) => c.json(await repo.listAlerts(fam(c), c.req.query('all') !== '1')));
  parent.post('/alerts/seen', async (c) => {
    await repo.markAlertsSeen(fam(c));
    return c.json({ ok: true });
  });

  /** Upload an audio file (e.g. a podcast episode) for an audio task; returns the URL to use as the task's url. */
  parent.post('/audio', async (c) => {
    fam(c);
    const form = await c.req.parseBody();
    if (!(form['audio'] instanceof File)) throw new HTTPException(400, { message: 'audio file required' });
    return c.json({ url: `${baseUrl(c)}/audio/${await saveAudio(form['audio'])}` }, 201);
  });

  /** JSON {text} = spoken on the kid's phone by on-device TTS. Multipart {audio} = the parent's own recording. */
  parent.post('/kids/:kidId/messages', async (c) => {
    const kid = await kidParam(c);
    let id: string;
    if (c.req.header('content-type')?.startsWith('multipart/form-data')) {
      const form = await c.req.parseBody();
      if (!(form['audio'] instanceof File)) throw new HTTPException(400, { message: 'audio file required' });
      id = await repo.addMessage(kid.id, 'audio', typeof form['text'] === 'string' ? form['text'] : null, await saveAudio(form['audio']));
    } else {
      const { text } = await body(c, z.object({ text: z.string().min(1).max(500) }));
      id = await repo.addMessage(kid.id, 'tts', text, null);
    }
    await notifyKid(kid.id, 'new-message', { title: 'Message from home', body: 'Tap to listen' });
    return c.json({ id }, 201);
  });

  parent.post('/agent/chat', async (c) => {
    const { messages } = await body(
      c,
      z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).min(1) }),
    );
    return c.json(await runAgent(repo, fam(c), messages));
  });

  // ---------- Self mode: a signed-in user coaching their own phone ----------
  const self = new Hono<ParentEnv>().use(parentAuth);
  const ChatHistory = z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).min(1) });
  const me = async (c: Context<ParentEnv>) => {
    const profile = await repo.selfProfile(c.get('userId'));
    if (!profile || profile.revoked) throw new CodedError(404, 'Set up Mello for yourself first', 'no_self');
    return profile;
  };
  const publicProfile = ({ familyId: _f, revoked: _r, ...p }: NonNullable<Awaited<ReturnType<typeof repo.selfProfile>>>) => p;

  /** Creates the user's self subject, or moves it to this phone (the previous phone's token stops working). */
  self.post('/setup', async (c) => {
    const { name } = await body(c, z.object({ name: z.string().trim().min(1).max(40) }));
    const { subjectId, deviceToken } = await repo.setupSelf(c.get('userId'), name);
    return c.json({ subjectId, deviceToken, profile: publicProfile((await repo.selfProfile(c.get('userId')))!) }, 201);
  });
  self.get('/profile', async (c) => c.json(publicProfile(await me(c))));
  self.put('/profile', async (c) => {
    await me(c);
    return c.json(publicProfile((await repo.updateSelfProfile(c.get('userId'), await body(c, SelfProfileInput)))!));
  });

  self.put('/usage', async (c) => {
    const p = await me(c);
    await repo.putUsageDay(p.subjectId, await body(c, UsageDay));
    return c.body(null, 204);
  });
  self.get('/usage', async (c) => {
    const p = await me(c);
    const usage = await repo.usageDays(p.subjectId, Number(c.req.query('days') ?? 7) || 7);
    const today = Day.catch(new Date().toISOString().slice(0, 10)).parse(c.req.query('today'));
    return c.json({ days: usage, streak: streakOf(usage, today) });
  });

  self.post('/reflect', async (c) => {
    const p = await me(c);
    const s = await body(c, z.object({ appLabel: z.string().max(80), title: z.string().trim().max(120).nullable().default(null), minutes: z.number().int().min(1).max(600) }));
    return c.json({ questions: await reflectionQuestions(p, s) });
  });
  self.post('/reflections', async (c) => {
    const p = await me(c);
    const r = await body(
      c,
      z.object({
        title: z.string().trim().max(120).nullable().default(null),
        questions: z.array(z.string().max(300)).max(3),
        answers: z.array(z.string().max(2000)).max(3),
      }),
    );
    const answered = r.answers.some((a) => a.trim());
    const reply = answered ? await reflectionReply(p, r.questions, r.answers) : null;
    await repo.addReflection(p.subjectId, { ...r, reply });
    return c.json({ reply }, 201);
  });

  self.post('/coach/chat', async (c) => {
    const profile = await me(c);
    const { messages } = await body(c, ChatHistory);
    const subject = (await repo.getKid(profile.familyId, profile.subjectId))!;
    return c.json(await runCoach(repo, { userId: c.get('userId'), familyId: profile.familyId, subject, profile: publicProfile(profile) }, messages));
  });

  /** Wipes usage history, reflections, sessions and alerts. Goals and limits stay. */
  self.delete('/data', async (c) => {
    await repo.deleteSelfData((await me(c)).subjectId);
    return c.body(null, 204);
  });
  /** Signs this phone out of self mode. Your own phone, so no password; the next setup issues a new token. */
  self.post('/signout', async (c) => {
    await repo.revokeKid((await me(c)).subjectId);
    return c.body(null, 204);
  });

  // ---------- Kid device ----------
  const kid = new Hono<KidEnv>().use(kidAuth);

  kid.put('/me/device', async (c) => {
    const d = await body(
      c,
      z.object({
        pushToken: z.string().max(300).nullable().default(null),
        installedApps: z.array(InstalledApp).max(2000).nullable().default(null),
        status: DeviceStatus.nullable().default(null),
      }),
    );
    await repo.updateDevice(c.get('kidId'), d);
    return c.json({ ok: true });
  });

  // ----- signing this phone out (needs the parent) -----
  kid.post('/unpair', async (c) => {
    const { password } = await body(c, z.object({ password: z.string().min(1).max(100) }));
    const result = await repo.tryUnpairWithPassword(c.get('kidId'), password);
    if (result === 'no-password') throw new CodedError(409, 'Your parent has not set a sign-out password yet', 'no_password');
    if (result === 'locked') throw new CodedError(429, 'Too many wrong tries. Wait 15 minutes or ask your parent to approve.', 'locked');
    if (result === 'wrong') throw new CodedError(403, 'That password is not right', 'wrong_password');
    return c.body(null, 204);
  });
  kid.post('/unpair-requests', async (c) => c.json(await repo.requestUnpair(c.get('kidId')), 201));
  // Once approved the token is revoked, so the phone sees 401 device_unpaired here and signs out.
  kid.get('/unpair-requests/:id', async (c) => {
    const status = await repo.unpairRequestStatus(c.get('kidId'), c.req.param('id'));
    if (!status) throw new HTTPException(404, { message: 'Request not found' });
    return c.json({ status });
  });

  /** Everything the phone needs to enforce the family's rules. `day` is the phone's local date for task progress. */
  kid.get('/me/config', async (c) => {
    const day = Day.catch(new Date().toISOString().slice(0, 10)).parse(c.req.query('day'));
    const k = (await repo.getKid(c.get('familyId'), c.get('kidId')))!;
    const book = k.currentBookId ? await repo.getBook(c.get('familyId'), k.currentBookId) : null;
    const [rules, tasks, taskProgress, limits, quietHours] = await Promise.all([
      repo.listRules(k.id),
      repo.listTasks(k.id, true),
      repo.taskProgress(k.id, day),
      repo.listLimits(k.id),
      repo.getQuietHours(k.id),
    ]);
    const config: KidConfig = {
      kid: k,
      rules,
      currentBook: book ? { id: book.id, title: book.title, author: book.author, ageLevel: book.ageLevel } : null,
      tasks,
      taskProgress,
      limits,
      quietHours,
    };
    return c.json(config);
  });

  /** A kid picks Mello's colour and nickname. Kids always get the gentle tone. */
  kid.put('/me/character', async (c) => {
    const prefs = await body(c, CharacterPrefs);
    const k = (await repo.getKid(c.get('familyId'), c.get('kidId')))!;
    const character = k.kind === 'kid' ? { ...prefs, tone: 'gentle' as const } : prefs;
    return c.json(await repo.updateSettings(c.get('familyId'), k.id, { character }));
  });

  kid.post('/tasks/:taskId/progress', async (c) => {
    // Small increments only: the phone reports every ~30 s while the activity is verifiably happening.
    const { day, seconds } = await body(c, z.object({ day: Day, seconds: z.number().int().min(1).max(300) }));
    const p = await repo.addTaskProgress(c.get('kidId'), c.req.param('taskId'), day, seconds);
    if (!p) throw new HTTPException(404, { message: 'Task not found' });
    return c.json(p);
  });

  kid.post('/location', async (c) => {
    const k = (await repo.getKid(c.get('familyId'), c.get('kidId')))!;
    if (!k.settings.location) throw new CodedError(403, 'Location sharing is off', 'location_off');
    const { lat, lng, accuracyM } = await body(
      c,
      z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracyM: z.number().min(0).nullable().default(null) }),
    );
    await repo.addLocation(k.id, lat, lng, accuracyM);
    return c.json({ ok: true }, 201);
  });

  kid.post('/alerts', async (c) => {
    const { kind, detail } = await body(
      c,
      z.object({ kind: z.enum(['bedtime_attempt', 'limit_reached', 'protection_off', 'gate_bypass_attempt', 'break_glass']), detail: z.record(z.string(), z.unknown()).default({}) }),
    );
    await repo.addAlert(c.get('kidId'), kind, detail);
    return c.json({ ok: true }, 201);
  });

  kid.get('/books/:bookId', async (c) => {
    const book = await repo.getBook(c.get('familyId'), c.req.param('bookId'));
    if (!book) throw new HTTPException(404, { message: 'Book not found' });
    return c.json(book);
  });

  kid.post('/challenges', async (c) => {
    const { bookId, passage } = await body(c, z.object({ bookId: z.string().nullable(), passage: z.string().min(100).max(20000) }));
    const book = bookId ? await repo.getBook(c.get('familyId'), bookId) : null;
    const generated = await generateChallenge(passage, book?.ageLevel ?? null);
    const challengeId = await repo.saveChallenge(c.get('kidId'), book?.id ?? null, generated);
    const pub: PublicChallenge = { challengeId, questions: generated.questions.map(({ question, choices }) => ({ question, choices })) };
    return c.json(pub, 201);
  });

  kid.post('/challenges/:id/answers', async (c) => {
    const { answers } = await body(c, z.object({ answers: z.array(z.number().int().min(0).max(3)).max(3) }));
    const stored = await repo.getChallenge(c.get('kidId'), c.req.param('id'));
    if (!stored) throw new HTTPException(404, { message: 'Challenge not found' });
    if (stored.result) throw new HTTPException(409, { message: 'Already answered' });
    const result = grade(stored.challenge, answers);
    await repo.setChallengeResult(c.req.param('id'), result);
    return c.json(result);
  });

  kid.post('/sessions', async (c) => {
    const s = await body(
      c,
      z.object({
        bookId: z.string().optional(),
        taskId: z.string().optional(),
        seconds: z.number().int().min(0).max(4 * 3600),
        fromPage: z.number().int().optional(),
        toPage: z.number().int().optional(),
        appPackage: z.string().optional(),
        challengeId: z.string().optional(),
        passed: z.boolean().optional(),
      }),
    );
    await repo.addSession(c.get('kidId'), s);
    return c.json({ ok: true }, 201);
  });

  kid.get('/me/messages', async (c) => c.json(await repo.listMessages(c.get('kidId'), baseUrl(c), c.req.query('unplayed') === '1')));
  kid.post('/me/messages/:id/played', async (c) => c.json({ ok: await repo.markPlayed(c.get('kidId'), c.req.param('id')) }));

  // Audio files use unguessable UUID names; good enough for now, swap for signed URLs with object storage.
  app.get('/audio/:file', async (c) => {
    const file = c.req.param('file');
    if (!/^[\w-]+\.[a-z0-9]{1,5}$/i.test(file)) throw new HTTPException(400);
    try {
      const data = await readFile(join(UPLOAD_DIR, file));
      const type = file.endsWith('.mp3') ? 'audio/mpeg' : file.endsWith('.ogg') ? 'audio/ogg' : file.endsWith('.wav') ? 'audio/wav' : 'audio/mp4';
      return c.body(data, 200, { 'content-type': type });
    } catch {
      throw new HTTPException(404);
    }
  });

  // Separate prefixes so each sub-app's auth middleware only covers its own routes.
  app.route('/parent', parent);
  app.route('/kid', kid);
  app.route('/self', self);
  return app;
}
