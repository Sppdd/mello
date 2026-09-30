import OpenAI from 'openai';
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BookInput, InstalledApp, RuleInput, type KidConfig, type PublicChallenge } from '@mello/shared';
import type { DatabaseSync } from 'node:sqlite';
import { Repo } from './repo.ts';
import { generateChallenge, grade } from './challenge.ts';
import { runAgent } from './agent.ts';
import { sendPush } from './push.ts';
import { LlmUnavailableError } from './llm.ts';
import { newId } from './db.ts';

type ParentEnv = { Variables: { familyId: string } };
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
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export function createApp(db: DatabaseSync) {
  const repo = new Repo(db);
  const app = new Hono();

  const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const parentAuth = createMiddleware<ParentEnv>(async (c, next) => {
    const family = repo.familyByToken(bearer(c));
    if (!family) throw new HTTPException(401, { message: 'Parent token required' });
    c.set('familyId', family.id);
    await next();
  });
  const kidAuth = createMiddleware<KidEnv>(async (c, next) => {
    const kid = repo.kidByToken(bearer(c));
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

  app.onError((err, c) => {
    if (err instanceof CodedError) return c.json({ error: err.message, code: err.code }, err.status);
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof LlmUnavailableError) return c.json({ error: err.message, code: 'llm_unavailable' }, 503);
    // Token Factory refused or failed (bad key, no access to the model, outage): the phone falls back to time-only.
    if (err instanceof OpenAI.APIError) {
      console.error(`[llm] ${err.status} ${err.message}`);
      return c.json({ error: `AI service error (${err.status ?? 'network'})`, code: 'llm_unavailable' }, 503);
    }
    console.error(err);
    return c.json({ error: 'Internal error' }, 500);
  });

  app.get('/health', (c) => c.json({ ok: true }));

  // ---------- Pairing ----------
  app.post('/families', async (c) => {
    const { name } = await body(c, z.object({ name: z.string().min(1).max(60) }));
    return c.json(repo.createFamily(name), 201);
  });

  app.post('/pair', async (c) => {
    const { code, kidName } = await body(c, z.object({ code: z.string().length(6), kidName: z.string().min(1).max(40) }));
    const kid = repo.pairKid(code, kidName);
    if (!kid) throw new HTTPException(404, { message: 'Pairing code not found' });
    return c.json({ kidId: kid.id, deviceToken: kid.deviceToken }, 201);
  });

  // ---------- Parent ----------
  const parent = new Hono<ParentEnv>().use(parentAuth);
  const kidParam = (c: Context<ParentEnv>) => {
    const kid = repo.getKid(c.get('familyId'), c.req.param('kidId')!);
    if (!kid) throw new HTTPException(404, { message: 'Kid not found' });
    return kid;
  };

  parent.get('/family', (c) => {
    const f = repo.familyByToken(bearer(c))!;
    return c.json({ id: f.id, name: f.name, pairingCode: f.pairing_code, hasPassword: !!f.has_password });
  });

  // Password a kid's phone must enter to sign out. A PIN is fine; the phone side is rate-limited.
  parent.put('/password', async (c) => {
    const { password } = await body(c, z.object({ password: z.string().min(4).max(100) }));
    repo.setParentPassword(c.get('familyId'), password);
    return c.json({ ok: true });
  });
  parent.get('/unpair-requests', (c) => c.json(repo.pendingUnpairRequests(c.get('familyId'))));
  parent.post('/unpair-requests/:id', async (c) => {
    const { approve } = await body(c, z.object({ approve: z.boolean() }));
    if (!repo.decideUnpairRequest(c.get('familyId'), c.req.param('id'), approve))
      throw new HTTPException(404, { message: 'Request not found or already decided' });
    return c.json({ ok: true });
  });
  parent.get('/kids', (c) => c.json(repo.listKids(c.get('familyId'))));
  parent.get('/kids/:kidId/rules', (c) => c.json(repo.listRules(kidParam(c).id)));
  parent.post('/kids/:kidId/rules', async (c) => {
    const kid = kidParam(c);
    const rule = repo.addRule(kid.id, await body(c, RuleInput));
    await sendPush(repo.pushToken(kid.id), 'rules-changed');
    return c.json(rule, 201);
  });
  parent.delete('/rules/:ruleId', (c) => {
    if (!repo.deleteRule(c.get('familyId'), c.req.param('ruleId'))) throw new HTTPException(404, { message: 'Rule not found' });
    return c.body(null, 204);
  });
  parent.put('/kids/:kidId/book', async (c) => {
    const kid = kidParam(c);
    const { bookId } = await body(c, z.object({ bookId: z.string() }));
    if (!repo.setCurrentBook(c.get('familyId'), kid.id, bookId)) throw new HTTPException(404, { message: 'Book not found' });
    await sendPush(repo.pushToken(kid.id), 'book-assigned', { title: 'New book!', body: 'You have a new book to read in Mello.' });
    return c.json({ ok: true });
  });
  parent.get('/kids/:kidId/report', (c) => c.json(repo.report(kidParam(c).id, Number(c.req.query('days') ?? 7))));
  parent.get('/kids/:kidId/messages', (c) => c.json(repo.listMessages(kidParam(c).id, baseUrl(c), false)));

  parent.get('/books', (c) => c.json(repo.listBooks(c.get('familyId'))));
  parent.post('/books', async (c) => c.json(repo.addBook(c.get('familyId'), await body(c, BookInput)), 201));

  /** JSON {text} = spoken on the kid's phone by on-device TTS. Multipart {audio} = the parent's own recording. */
  parent.post('/kids/:kidId/messages', async (c) => {
    const kid = kidParam(c);
    let id: string;
    if (c.req.header('content-type')?.startsWith('multipart/form-data')) {
      const form = await c.req.parseBody();
      const file = form['audio'];
      if (!(file instanceof File)) throw new HTTPException(400, { message: 'audio file required' });
      if (file.size > MAX_AUDIO_BYTES) throw new HTTPException(413, { message: 'Recording is too long' });
      const ext = (file.name.split('.').pop() ?? 'm4a').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'm4a';
      const fileName = `${newId()}.${ext}`;
      await mkdir(UPLOAD_DIR, { recursive: true });
      await writeFile(join(UPLOAD_DIR, fileName), Buffer.from(await file.arrayBuffer()));
      id = repo.addMessage(kid.id, 'audio', typeof form['text'] === 'string' ? form['text'] : null, fileName);
    } else {
      const { text } = await body(c, z.object({ text: z.string().min(1).max(500) }));
      id = repo.addMessage(kid.id, 'tts', text, null);
    }
    await sendPush(repo.pushToken(kid.id), 'new-message', { title: 'Message from home', body: 'Tap to listen' });
    return c.json({ id }, 201);
  });

  parent.post('/agent/chat', async (c) => {
    const { messages } = await body(
      c,
      z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).min(1) }),
    );
    return c.json(await runAgent(repo, c.get('familyId'), messages));
  });

  // ---------- Kid device ----------
  const kid = new Hono<KidEnv>().use(kidAuth);

  kid.put('/me/device', async (c) => {
    const { pushToken, installedApps } = await body(
      c,
      z.object({ pushToken: z.string().nullable().default(null), installedApps: z.array(InstalledApp).max(1000).nullable().default(null) }),
    );
    repo.updateDevice(c.get('kidId'), pushToken, installedApps);
    return c.json({ ok: true });
  });

  // ----- signing this phone out (needs the parent) -----
  kid.post('/unpair', async (c) => {
    const { password } = await body(c, z.object({ password: z.string().min(1).max(100) }));
    const result = repo.tryUnpairWithPassword(c.get('kidId'), password);
    if (result === 'no-password') throw new CodedError(409, 'Your parent has not set a sign-out password yet', 'no_password');
    if (result === 'locked') throw new CodedError(429, 'Too many wrong tries. Wait 15 minutes or ask your parent to approve.', 'locked');
    if (result === 'wrong') throw new CodedError(403, 'That password is not right', 'wrong_password');
    return c.body(null, 204);
  });
  kid.post('/unpair-requests', (c) => c.json(repo.requestUnpair(c.get('kidId')), 201));
  // Once approved the token is revoked, so the phone sees 401 device_unpaired here and signs out.
  kid.get('/unpair-requests/:id', (c) => {
    const status = repo.unpairRequestStatus(c.get('kidId'), c.req.param('id'));
    if (!status) throw new HTTPException(404, { message: 'Request not found' });
    return c.json({ status });
  });

  kid.get('/me/config', (c) => {
    const k = repo.getKid(c.get('familyId'), c.get('kidId'))!;
    const book = k.currentBookId ? repo.getBook(c.get('familyId'), k.currentBookId) : null;
    const config: KidConfig = {
      kid: k,
      rules: repo.listRules(k.id),
      currentBook: book ? { id: book.id, title: book.title, author: book.author, ageLevel: book.ageLevel } : null,
    };
    return c.json(config);
  });

  kid.get('/books/:bookId', (c) => {
    const book = repo.getBook(c.get('familyId'), c.req.param('bookId'));
    if (!book) throw new HTTPException(404, { message: 'Book not found' });
    return c.json(book);
  });

  kid.post('/challenges', async (c) => {
    const { bookId, passage } = await body(c, z.object({ bookId: z.string().nullable(), passage: z.string().min(100).max(20000) }));
    const book = bookId ? repo.getBook(c.get('familyId'), bookId) : null;
    const generated = await generateChallenge(passage, book?.ageLevel ?? null);
    const challengeId = repo.saveChallenge(c.get('kidId'), bookId, generated);
    const pub: PublicChallenge = { challengeId, questions: generated.questions.map(({ question, choices }) => ({ question, choices })) };
    return c.json(pub, 201);
  });

  kid.post('/challenges/:id/answers', async (c) => {
    const { answers } = await body(c, z.object({ answers: z.array(z.number().int().min(0).max(3)).max(3) }));
    const stored = repo.getChallenge(c.get('kidId'), c.req.param('id'));
    if (!stored) throw new HTTPException(404, { message: 'Challenge not found' });
    if (stored.result) throw new HTTPException(409, { message: 'Already answered' });
    const result = grade(stored.challenge, answers);
    repo.setChallengeResult(c.req.param('id'), result);
    return c.json(result);
  });

  kid.post('/sessions', async (c) => {
    const s = await body(
      c,
      z.object({
        bookId: z.string().optional(),
        seconds: z.number().int().min(0).max(4 * 3600),
        fromPage: z.number().int().optional(),
        toPage: z.number().int().optional(),
        appPackage: z.string().optional(),
        challengeId: z.string().optional(),
        passed: z.boolean().optional(),
      }),
    );
    repo.addSession(c.get('kidId'), s);
    return c.json({ ok: true }, 201);
  });

  kid.get('/me/messages', (c) => c.json(repo.listMessages(c.get('kidId'), baseUrl(c), c.req.query('unplayed') === '1')));
  kid.post('/me/messages/:id/played', (c) => c.json({ ok: repo.markPlayed(c.get('kidId'), c.req.param('id')) }));

  // Audio files use unguessable UUID names; good enough for v1, swap for signed URLs with object storage.
  app.get('/audio/:file', async (c) => {
    const file = c.req.param('file');
    if (!/^[\w-]+\.[a-z0-9]{1,5}$/i.test(file)) throw new HTTPException(400);
    try {
      const data = await readFile(join(UPLOAD_DIR, file));
      return c.body(data, 200, { 'content-type': file.endsWith('.mp3') ? 'audio/mpeg' : 'audio/mp4' });
    } catch {
      throw new HTTPException(404);
    }
  });

  // Separate prefixes so each sub-app's auth middleware only covers its own routes.
  app.route('/parent', parent);
  app.route('/kid', kid);
  return app;
}
