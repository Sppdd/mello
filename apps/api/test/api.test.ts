import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  SKIN_LIST,
  KidSettings,
  categoryFor,
  characterLine,
  computeStreak,
  evaluateGate,
  focusDecision,
  GeneratedChallenge,
  inQuietHours,
  isPassing,
  minutesLeft,
  paginate,
  personaPrompt,
  TaskInput,
  youtubeId,
  type Rule,
  type UsageDay,
} from '@mello/shared';
import { openDb, type Db } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { Repo } from '../src/repo.ts';
import { executeTool, type AgentAction } from '../src/agent.ts';
import { executeCoachTool } from '../src/coach.ts';
import { extractJson, grade } from '../src/challenge.ts';

// ---------- pure logic ----------

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  kidId: 'k1',
  apps: ['com.instagram.android'],
  activity: 'reading',
  taskId: null,
  minutesRequired: 5,
  unlockMinutes: 30,
  enabled: true,
  ...over,
});

describe('evaluateGate', () => {
  it('blocks covered apps', () => {
    expect(evaluateGate([rule()], 'com.instagram.android', {})).toMatchObject({ blocked: true, reason: 'rule' });
  });
  it('lets through apps no rule covers', () => {
    expect(evaluateGate([rule()], 'com.whatsapp', {})).toEqual({ blocked: false, reason: 'not-covered' });
  });
  it('respects an active unlock and expires it', () => {
    const now = 1_000_000;
    expect(evaluateGate([rule()], 'com.instagram.android', { 'com.instagram.android': now + 1 }, now).blocked).toBe(false);
    expect(evaluateGate([rule()], 'com.instagram.android', { 'com.instagram.android': now - 1 }, now).blocked).toBe(true);
  });
  it('never blocks the dialer, even if a parent adds it', () => {
    expect(evaluateGate([rule({ apps: ['com.google.android.dialer'] })], 'com.google.android.dialer', {}).blocked).toBe(false);
  });
  it('ignores disabled rules, prefers task rules, else the strictest reading rule', () => {
    const d = evaluateGate([rule({ minutesRequired: 1 }), rule({ id: 'r2', minutesRequired: 10 }), rule({ id: 'r3', minutesRequired: 60, enabled: false })], 'com.instagram.android', {});
    expect(d.blocked && d.reason === 'rule' && d.rule.id).toBe('r2');
    const t = evaluateGate([rule({ minutesRequired: 60 }), rule({ id: 't', activity: 'task', taskId: 'x', minutesRequired: 5 })], 'com.instagram.android', {});
    expect(t.blocked && t.reason === 'rule' && t.rule.id).toBe('t');
  });
  it('blocks everything but allowed apps at bedtime, across midnight', () => {
    const q = { enabled: true, startMinute: 21 * 60, endMinute: 7 * 60, allowedApps: ['com.audible'] };
    const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m).getTime();
    expect(evaluateGate({ rules: [], quietHours: q }, 'com.whatsapp', {}, at(22)).blocked).toBe(true);
    expect(evaluateGate({ rules: [], quietHours: q }, 'com.whatsapp', {}, at(6, 59)).blocked).toBe(true);
    expect(evaluateGate({ rules: [], quietHours: q }, 'com.whatsapp', {}, at(7)).blocked).toBe(false);
    expect(evaluateGate({ rules: [], quietHours: q }, 'com.audible', {}, at(23)).blocked).toBe(false);
    expect(inQuietHours({ ...q, enabled: false }, 22 * 60)).toBe(false);
  });
  it('blocks an app once its daily limit is used, even if unlocked', () => {
    const ctx = { rules: [rule()], limits: [{ packageName: 'com.instagram.android', dailyMinutes: 30 }], usageToday: { 'com.instagram.android': 30 } };
    expect(evaluateGate(ctx, 'com.instagram.android', { 'com.instagram.android': Date.now() + 60_000 })).toMatchObject({ blocked: true, reason: 'limit' });
    expect(minutesLeft(ctx.limits, { 'com.instagram.android': 12 }, 'com.instagram.android')).toBe(18);
    expect(minutesLeft(ctx.limits, {}, 'com.other')).toBeNull();
  });
});

describe('challenges', () => {
  const challenge = GeneratedChallenge.parse({
    questions: [
      { question: 'Who?', choices: ['a', 'b', 'c', 'd'], answerIndex: 1 },
      { question: 'Where?', choices: ['a', 'b', 'c', 'd'], answerIndex: 2 },
      { question: 'Why?', choices: ['a', 'b', 'c', 'd'], answerIndex: 0 },
    ],
  });
  it('passes at 2 of 3 and fails at 1 of 3', () => {
    expect(grade(challenge, [1, 2, 3]).passed).toBe(true);
    expect(grade(challenge, [1, 0, 3]).passed).toBe(false);
    expect(isPassing(2, 2)).toBe(true);
    expect(isPassing(1, 2)).toBe(false);
  });
  it('rejects model output with the wrong number of choices', () => {
    expect(GeneratedChallenge.safeParse({ questions: [{ question: 'x?', choices: ['a'], answerIndex: 0 }] }).success).toBe(false);
  });
  it('extracts JSON from fenced model output', () => {
    expect(JSON.parse(extractJson('```json\n{"a":1}\n```'))).toEqual({ a: 1 });
  });
});

describe('tasks input', () => {
  it('parses YouTube ids from the usual link shapes', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://vimeo.com/123')).toBeNull();
  });
  it('requires URLs where needed and YouTube for videos', () => {
    expect(TaskInput.safeParse({ kind: 'video', title: 'x', url: 'https://vimeo.com/1', requiredMinutes: 5 }).success).toBe(false);
    expect(TaskInput.safeParse({ kind: 'article', title: 'x', requiredMinutes: 5 }).success).toBe(false);
    expect(TaskInput.safeParse({ kind: 'reading', title: 'x', requiredMinutes: 5 }).success).toBe(true);
    expect(TaskInput.safeParse({ kind: 'audio', title: 'x', url: 'javascript:alert(1)', requiredMinutes: 5 }).success).toBe(false);
  });
});

describe('paginate', () => {
  it('keeps paragraphs whole and splits long text', () => {
    const para = Array(100).fill('word').join(' ');
    expect(paginate([para, para, para].join('\n\n'), 180)).toHaveLength(3);
  });
});

// ---------- HTTP API on a real Postgres (PGlite) ----------

let db: Db;
beforeAll(async () => {
  db = await openDb({ url: '', pglitePath: 'memory://' }); // never the real database
});
afterAll(async () => {
  await db.close();
});

/** Parent tokens in tests are "parent:<uuid>"; production verifies Supabase JWTs instead. */
const fakeVerifier = async (token: string) => (token.startsWith('parent:') ? token.slice(7) : null);

async function setup() {
  const app = createApp(db, { verifyParentToken: fakeVerifier });
  const call = async (method: string, path: string, token?: string, json?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  const parentToken = `parent:${randomUUID()}`;
  const family = (await call('POST', '/parent/family', parentToken, { name: 'Home' })).body;
  const kid = (await call('POST', '/pair', undefined, { code: family.pairingCode, kidName: 'Sara' })).body;
  return { app, call, parentToken, family, kid };
}

describe('HTTP API', () => {
  it('needs a signed-in parent, and a family before anything else', async () => {
    const { call } = await setup();
    expect((await call('GET', '/parent/kids')).status).toBe(401);
    const fresh = `parent:${randomUUID()}`;
    expect((await call('GET', '/parent/kids', fresh)).body.code).toBe('no_family');
    expect((await call('POST', '/parent/family', fresh, { name: 'X' })).status).toBe(201);
    expect((await call('POST', '/parent/family', fresh, { name: 'Y' })).body.code).toBe('family_exists');
  });

  it('pairs a kid, sets a rule and delivers it to the kid config', async () => {
    const { call, parentToken, kid } = await setup();
    await call('PUT', '/kid/me/device', kid.deviceToken, {
      installedApps: [{ packageName: 'com.zhiliaoapp.musically', label: 'TikTok' }],
      status: { gateEnabled: true },
    });
    const created = await call('POST', `/parent/kids/${kid.kidId}/rules`, parentToken, { apps: ['com.zhiliaoapp.musically'], minutesRequired: 5 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ unlockMinutes: 30, activity: 'reading' });

    const config = await call('GET', '/kid/me/config?day=2026-09-30', kid.deviceToken);
    expect(config.body.rules).toHaveLength(1);
    expect(config.body.kid.installedApps[0].label).toBe('TikTok');
    expect(config.body.kid.settings).toMatchObject({ location: false, photoProof: false, attentionChecks: true, character: { characterId: 'mello' } });
    expect(config.body.kid.kind).toBe('kid');
  });

  it('keeps parent and kid tokens apart, and families apart', async () => {
    const { call, parentToken, kid } = await setup();
    expect((await call('GET', '/kid/me/config', parentToken)).status).toBe(401);
    expect((await call('GET', '/parent/kids', kid.deviceToken)).status).toBe(401);
    const other = (await setup()).parentToken;
    expect((await call('GET', `/parent/kids/${kid.kidId}/rules`, other)).status).toBe(404);
    expect((await call('GET', `/parent/kids/not-a-uuid/rules`, parentToken)).status).toBe(404);
  });

  it('rejects a bad pairing code', async () => {
    const { call } = await setup();
    expect((await call('POST', '/pair', undefined, { code: '000000', kidName: 'X' })).status).toBe(404);
  });

  it('sends a text message that the kid can list and mark played', async () => {
    const { call, parentToken, kid } = await setup();
    await call('POST', `/parent/kids/${kid.kidId}/messages`, parentToken, { text: 'Dinner in 10 minutes!' });
    const unplayed = await call('GET', '/kid/me/messages?unplayed=1', kid.deviceToken);
    expect(unplayed.body).toHaveLength(1);
    expect(unplayed.body[0]).toMatchObject({ kind: 'tts', text: 'Dinner in 10 minutes!' });
    await call('POST', `/kid/me/messages/${unplayed.body[0].id}/played`, kid.deviceToken);
    expect((await call('GET', '/kid/me/messages?unplayed=1', kid.deviceToken)).body).toHaveLength(0);
  });

  it('grades a stored challenge once', async () => {
    const repo = new Repo(db);
    const { call, kid } = await setup();
    const id = await repo.saveChallenge(kid.kidId, null, {
      questions: [
        { question: 'Who?', choices: ['a', 'b', 'c', 'd'], answerIndex: 1 },
        { question: 'Where?', choices: ['a', 'b', 'c', 'd'], answerIndex: 2 },
        { question: 'Why?', choices: ['a', 'b', 'c', 'd'], answerIndex: 0 },
      ],
    });
    const res = await call('POST', `/kid/challenges/${id}/answers`, kid.deviceToken, { answers: [1, 2, 3] });
    expect(res.body).toMatchObject({ passed: true, correct: 2, total: 3 });
    expect((await call('POST', `/kid/challenges/${id}/answers`, kid.deviceToken, { answers: [1, 2, 0] })).status).toBe(409);
  });

  it('returns 503 for challenges when the LLM key is missing', async () => {
    const saved = process.env.NEBIUS_API_KEY;
    delete process.env.NEBIUS_API_KEY;
    const { call, kid } = await setup();
    expect((await call('POST', '/kid/challenges', kid.deviceToken, { bookId: null, passage: 'x'.repeat(200) })).status).toBe(503);
    process.env.NEBIUS_API_KEY = saved;
  });
});

describe('tasks, limits and bedtime', () => {
  it('tracks task progress in small increments and completes at the required time', async () => {
    const { call, parentToken, kid } = await setup();
    const task = (await call('POST', `/parent/kids/${kid.kidId}/tasks`, parentToken, {
      kind: 'video', title: 'Fractions', url: 'https://youtu.be/dQw4w9WgXcQ', requiredMinutes: 2,
    })).body;
    const day = '2026-09-30';
    expect((await call('POST', `/kid/tasks/${task.id}/progress`, kid.deviceToken, { day, seconds: 301 })).status).toBe(400);
    expect((await call('POST', `/kid/tasks/${task.id}/progress`, kid.deviceToken, { day, seconds: 60 })).body).toMatchObject({ seconds: 60, completed: false });
    expect((await call('POST', `/kid/tasks/${task.id}/progress`, kid.deviceToken, { day, seconds: 60 })).body).toMatchObject({ seconds: 120, completed: true });

    const today = (await call('GET', `/kid/me/config?day=${day}`, kid.deviceToken)).body;
    expect(today.taskProgress).toEqual([{ taskId: task.id, seconds: 120, completed: true }]);
    // Daily tasks reset the next day.
    const tomorrow = (await call('GET', '/kid/me/config?day=2026-10-01', kid.deviceToken)).body;
    expect(tomorrow.taskProgress).toEqual([{ taskId: task.id, seconds: 0, completed: false }]);
  });

  it('lets a rule require a task, but only one of that kid', async () => {
    const { call, parentToken, kid } = await setup();
    const task = (await call('POST', `/parent/kids/${kid.kidId}/tasks`, parentToken, { kind: 'reading', title: 'Read', requiredMinutes: 10 })).body;
    const ok = await call('POST', `/parent/kids/${kid.kidId}/rules`, parentToken, { apps: ['a.b'], activity: 'task', taskId: task.id, minutesRequired: 10 });
    expect(ok.status).toBe(201);
    expect((await call('POST', `/parent/kids/${kid.kidId}/rules`, parentToken, { apps: ['a.b'], activity: 'task', minutesRequired: 10 })).status).toBe(400);
    const other = await setup();
    const foreign = await other.call('POST', `/parent/kids/${other.kid.kidId}/rules`, other.parentToken, { apps: ['a.b'], activity: 'task', taskId: task.id, minutesRequired: 10 });
    expect(foreign.status).toBe(404);
  });

  it('stores limits and bedtime and ships them in the kid config', async () => {
    const { call, parentToken, kid } = await setup();
    await call('PUT', `/parent/kids/${kid.kidId}/limits`, parentToken, { packageName: 'com.google.android.youtube', dailyMinutes: 45 });
    await call('PUT', `/parent/kids/${kid.kidId}/limits`, parentToken, { packageName: 'com.google.android.youtube', dailyMinutes: 30 });
    await call('PUT', `/parent/kids/${kid.kidId}/quiet-hours`, parentToken, { enabled: true, startMinute: 1260, endMinute: 420, allowedApps: [] });
    const cfg = (await call('GET', '/kid/me/config', kid.deviceToken)).body;
    expect(cfg.limits).toEqual([{ packageName: 'com.google.android.youtube', dailyMinutes: 30 }]);
    expect(cfg.quietHours).toMatchObject({ startMinute: 1260, endMinute: 420 });
  });

  it('alerts the parent when a protection is switched off', async () => {
    const { call, parentToken, kid } = await setup();
    await call('PUT', '/kid/me/device', kid.deviceToken, { status: { gateEnabled: true } });
    await call('PUT', '/kid/me/device', kid.deviceToken, { status: { gateEnabled: false } });
    await call('PUT', '/kid/me/device', kid.deviceToken, { status: { gateEnabled: false } });
    const alerts = (await call('GET', '/parent/alerts', parentToken)).body;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'protection_off', kidName: 'Sara', detail: { protection: 'gateEnabled' } });
    await call('POST', '/parent/alerts/seen', parentToken);
    expect((await call('GET', '/parent/alerts', parentToken)).body).toHaveLength(0);
  });

  it('only accepts location when the parent turned it on', async () => {
    const { call, parentToken, kid } = await setup();
    const loc = { lat: 33.3, lng: 44.4, accuracyM: 12 };
    expect((await call('POST', '/kid/location', kid.deviceToken, loc)).body.code).toBe('location_off');
    await call('PATCH', `/parent/kids/${kid.kidId}/settings`, parentToken, { location: true });
    expect((await call('POST', '/kid/location', kid.deviceToken, loc)).status).toBe(201);
    expect((await call('GET', `/parent/kids/${kid.kidId}/location`, parentToken)).body).toMatchObject({ lat: 33.3, lng: 44.4 });
  });
});

describe('signing a kid phone out', () => {
  it('needs a password to be set first', async () => {
    const { call, kid } = await setup();
    expect((await call('POST', '/kid/unpair', kid.deviceToken, { password: '1234' }))).toMatchObject({ status: 409, body: { code: 'no_password' } });
  });

  it('signs out with the right password and revokes the token', async () => {
    const { call, parentToken, kid } = await setup();
    await call('PUT', '/parent/password', parentToken, { password: '4821' });
    expect((await call('GET', '/parent/family', parentToken)).body.hasPassword).toBe(true);
    expect((await call('POST', '/kid/unpair', kid.deviceToken, { password: 'nope' })).body.code).toBe('wrong_password');
    expect((await call('POST', '/kid/unpair', kid.deviceToken, { password: '4821' })).status).toBe(204);
    expect(await call('GET', '/kid/me/config', kid.deviceToken)).toMatchObject({ status: 401, body: { code: 'device_unpaired' } });
    expect((await call('GET', '/parent/kids', parentToken)).body).toHaveLength(0);
  });

  it('locks after five wrong passwords, even for the right one', async () => {
    const { call, parentToken, kid } = await setup();
    await call('PUT', '/parent/password', parentToken, { password: '4821' });
    for (let i = 0; i < 4; i++) expect((await call('POST', '/kid/unpair', kid.deviceToken, { password: 'x' })).status).toBe(403);
    expect((await call('POST', '/kid/unpair', kid.deviceToken, { password: 'x' })).status).toBe(429);
    expect((await call('POST', '/kid/unpair', kid.deviceToken, { password: '4821' })).status).toBe(429);
  });

  it('signs out when the parent approves, stays paired when they decline', async () => {
    const { call, parentToken, kid } = await setup();
    const req = (await call('POST', '/kid/unpair-requests', kid.deviceToken)).body;
    expect((await call('POST', '/kid/unpair-requests', kid.deviceToken)).body.id).toBe(req.id);
    expect((await call('GET', '/parent/unpair-requests', parentToken)).body).toMatchObject([{ id: req.id, kidName: 'Sara' }]);
    await call('POST', `/parent/unpair-requests/${req.id}`, parentToken, { approve: false });
    expect((await call('GET', `/kid/unpair-requests/${req.id}`, kid.deviceToken)).body.status).toBe('denied');

    const again = (await call('POST', '/kid/unpair-requests', kid.deviceToken)).body;
    const other = (await setup()).parentToken;
    expect((await call('POST', `/parent/unpair-requests/${again.id}`, other, { approve: true })).status).toBe(404);
    await call('POST', `/parent/unpair-requests/${again.id}`, parentToken, { approve: true });
    expect((await call('GET', `/kid/unpair-requests/${again.id}`, kid.deviceToken)).body.code).toBe('device_unpaired');
  });
});

describe('agent tools', () => {
  it('sets rules, tasks, limits and bedtime by kid name, and refuses unknown apps', async () => {
    const repo = new Repo(db);
    const family = await repo.createFamily(randomUUID(), 'Home');
    const kid = (await repo.pairKid(family.pairing_code, 'Sara'))!;
    await repo.updateDevice(kid.id, { installedApps: [{ packageName: 'com.instagram.android', label: 'Instagram' }] });
    const actions: AgentAction[] = [];

    const r: any = await executeTool(repo, family.id, 'set_reading_rule', { kid: 'sara', apps: ['com.instagram.android'], minutes_required: 3 }, actions);
    expect(r.minutesRequired).toBe(3);
    const t: any = await executeTool(repo, family.id, 'create_task', {
      kid: 'Sara', kind: 'article', title: 'Volcanoes', url: 'https://example.org/volcanoes', minutes: 10, required_before_apps: ['com.instagram.android'],
    }, actions);
    expect(t.kind).toBe('article');
    expect((await repo.listRules(kid.id)).filter((x) => x.activity === 'task')).toHaveLength(1);
    await executeTool(repo, family.id, 'set_app_limit', { kid: 'Sara', app: 'com.instagram.android', minutes_per_day: 20 }, actions);
    await executeTool(repo, family.id, 'set_bedtime', { kid: 'Sara', start: '21:30', end: '07:00' }, actions);
    expect(await repo.getQuietHours(kid.id)).toMatchObject({ startMinute: 1290, endMinute: 420 });
    expect(actions.every((a) => a.ok)).toBe(true);

    await expect(executeTool(repo, family.id, 'set_reading_rule', { kid: 'Sara', apps: ['com.made.up'], minutes_required: 3 }, actions)).rejects.toThrow(/Not installed/);
    await expect(executeTool(repo, family.id, 'set_bedtime', { kid: 'Sara', start: '25:00', end: '07:00' }, actions)).rejects.toThrow(/HH:MM/);
    await expect(executeTool(repo, family.id, 'list_apps', { kid: 'Nobody' }, actions)).rejects.toThrow(/No kid named/);
  });
});

// ---------- self mode ----------

describe('Mello', () => {
  it('fills lines, and every skin keeps one persona', () => {
    expect(characterLine({}, 'bounce', { app: 'ReadEra' }, 1)).toBe('Back to ReadEra. Small steps.');
    for (const s of SKIN_LIST) {
      const prompt = personaPrompt({ skin: s.id, tone: 'firm' }, 'Ali');
      expect(prompt).toMatch(/^You are Mello, a giant tortoise/);
      expect(prompt).toMatch(/never insult or shame/);
      expect(prompt).toMatch(/Never mention being an AI/);
    }
    expect(personaPrompt({ nickname: 'Shelly' }, 'Ali')).toMatch(/^You are Shelly, a giant tortoise/);
  });
  it('turns characters saved by older builds into Mello', () => {
    expect(KidSettings.parse({ character: { characterId: 'pip', tone: 'firm' }, allowedCharacters: ['pip'] }).character).toEqual({
      characterId: 'mello', skin: 'classic', nickname: null, tone: 'firm', voiceOn: true,
    });
  });
});

describe('kid buddy', () => {
  it('lets a kid pick a skin; kids always get the gentle tone', async () => {
    const { call, kid } = await setup();
    const res = await call('PUT', '/kid/me/character', kid.deviceToken, { skin: 'berry', tone: 'firm', nickname: 'Shelly' });
    expect(res.body.settings.character).toMatchObject({ characterId: 'mello', skin: 'berry', tone: 'gentle', nickname: 'Shelly' });
  });
});

describe('app tasks and categories', () => {
  it('needs an app for app tasks, and never a protected one', () => {
    expect(TaskInput.safeParse({ kind: 'app', title: 'Read', requiredMinutes: 20 }).success).toBe(false);
    expect(TaskInput.safeParse({ kind: 'app', title: 'Read', appPackage: 'com.android.settings', requiredMinutes: 20 }).success).toBe(false);
    expect(TaskInput.parse({ kind: 'app', title: 'Read', appPackage: 'org.readera', requiredMinutes: 20 })).toMatchObject({ url: null, appPackage: 'org.readera' });
  });
  it('categorises known apps first, then by the Android category', () => {
    expect(categoryFor('org.readera')).toBe('reading');
    expect(categoryFor('com.instagram.android', 7)).toBe('social');
    expect(categoryFor('com.some.game', 0)).toBe('game');
    expect(categoryFor('com.some.tool')).toBe('other');
  });
});

describe('focusDecision', () => {
  const focus = { target: 'org.readera', requiredMs: 60_000, elapsedMs: 0, lastActiveAt: 1_000_000, gatedApp: null };
  it('counts active time in the target and pauses when idle', () => {
    expect(focusDecision(focus, 'org.readera', 1_000_000 + 30_000)).toBe('count');
    expect(focusDecision(focus, 'org.readera', 1_000_000 + 91_000)).toBe('idle');
  });
  it('sends other apps back, but keeps Mello and emergency apps reachable', () => {
    expect(focusDecision(focus, 'com.instagram.android', 1_000_000)).toBe('return');
    expect(focusDecision(focus, 'com.google.android.apps.nexuslauncher', 1_000_000)).toBe('return');
    expect(focusDecision(focus, 'com.mello.app', 1_000_000)).toBe('allow');
    expect(focusDecision(focus, 'com.google.android.dialer', 1_000_000)).toBe('allow');
  });
  it('is done once enough time is in', () => {
    expect(focusDecision({ ...focus, elapsedMs: 60_000 }, 'com.instagram.android', 1_000_000)).toBe('done');
  });
});

describe('computeStreak', () => {
  const good = (day: string) => ({ day, guardOn: 1, goalMet: true });
  it('counts back from yesterday while today is in progress', () => {
    expect(computeStreak([good('2026-09-28'), good('2026-09-29'), good('2026-09-30')], '2026-10-01')).toMatchObject({ current: 3, todayDone: false });
    expect(computeStreak([good('2026-09-30'), good('2026-10-01')], '2026-10-01')).toMatchObject({ current: 2, todayDone: true });
  });
  it('needs the guard on and a goal met', () => {
    expect(computeStreak([{ day: '2026-09-30', guardOn: 0.5, goalMet: true }], '2026-10-01').current).toBe(0);
    expect(computeStreak([{ day: '2026-09-30', guardOn: 1, goalMet: false }], '2026-10-01').current).toBe(0);
  });
  it('bridges one missed day per week with a freeze, not two', () => {
    // Week of Mon 2026-09-21: miss Wed 23rd → frozen.
    const s = computeStreak([good('2026-09-21'), good('2026-09-22'), good('2026-09-24'), good('2026-09-25')], '2026-09-26');
    expect(s).toMatchObject({ current: 4, frozen: ['2026-09-23'] });
    // A second miss in the same week ends the run: 25, (24 frozen), 23, then 22 breaks it.
    const t = computeStreak([good('2026-09-21'), good('2026-09-23'), good('2026-09-25')], '2026-09-26');
    expect(t).toMatchObject({ current: 2, frozen: ['2026-09-24'], best: 2 });
  });
});

describe('self mode API', () => {
  const usage = (day: string, over: Partial<UsageDay> = {}): UsageDay => ({
    day,
    apps: [{ packageName: 'com.instagram.android', label: 'Instagram', category: 'social', minutes: 95, opens: 41 }],
    categories: { social: 95, reading: 10 },
    unlocks: 80,
    guardOn: 1,
    focusMinutes: 10,
    breakGlass: 0,
    goalMet: true,
    ...over,
  });

  it('sets up, reissues the token on a new phone, and stays out of parent views', async () => {
    const { call, parentToken, kid } = await setup();
    expect((await call('GET', '/self/profile', parentToken)).body.code).toBe('no_self');
    const first = await call('POST', '/self/setup', parentToken, { name: 'Ali' });
    expect(first.status).toBe(201);
    expect(first.body.profile).toMatchObject({ name: 'Ali', interests: [], alwaysSuggest: true, character: { characterId: 'mello' } });

    // The same /kid plumbing works with the self token.
    expect((await call('GET', '/kid/me/config', first.body.deviceToken)).body.kid).toMatchObject({ kind: 'self', name: 'Ali' });
    // Parents (and the parent agent) only see real kids, even if this user is also a parent.
    expect((await call('GET', '/parent/kids', parentToken)).body.map((k: any) => k.id)).toEqual([kid.kidId]);

    const second = await call('POST', '/self/setup', parentToken, { name: 'Ali' });
    expect(second.body.subjectId).toBe(first.body.subjectId);
    expect((await call('GET', '/kid/me/config', first.body.deviceToken)).status).toBe(401);
    expect((await call('GET', '/kid/me/config', second.body.deviceToken)).status).toBe(200);

    const updated = await call('PUT', '/self/profile', parentToken, { interests: ['stoicism'], character: { skin: 'night', tone: 'firm' } });
    expect(updated.body).toMatchObject({ interests: ['stoicism'], character: { characterId: 'mello', skin: 'night', tone: 'firm', voiceOn: true } });

    expect((await call('POST', '/self/signout', parentToken)).status).toBe(204);
    expect((await call('GET', '/kid/me/config', second.body.deviceToken)).status).toBe(401);
    expect((await call('GET', '/self/profile', parentToken)).body.code).toBe('no_self');
  });

  it('stores daily aggregates for 30 days, computes the streak, and deletes on request', async () => {
    const { call, parentToken } = await setup();
    const s = (await call('POST', '/self/setup', parentToken, { name: 'Ali' })).body;
    const iso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
    expect((await call('PUT', '/self/usage', parentToken, usage(iso(1)))).status).toBe(204);
    await call('PUT', '/self/usage', parentToken, usage(iso(2)));
    await call('PUT', '/self/usage', parentToken, usage(iso(2), { unlocks: 12 })); // upsert
    await call('PUT', '/self/usage', parentToken, usage(iso(40)));
    expect((await call('PUT', '/self/usage', parentToken, { ...usage(iso(0)), guardOn: 2 })).status).toBe(400);

    const got = (await call('GET', `/self/usage?days=30&today=${iso(0)}`, parentToken)).body;
    expect(got.days.map((d: UsageDay) => d.day)).toEqual([iso(1), iso(2)]); // the 40-day-old one was pruned
    expect(got.days[1].unlocks).toBe(12);
    expect(got.streak).toMatchObject({ current: 2, todayDone: false });

    await call('POST', '/kid/sessions', s.deviceToken, { seconds: 600, appPackage: 'org.readera' });
    expect((await call('DELETE', '/self/data', parentToken)).status).toBe(204);
    expect((await call('GET', '/self/usage', parentToken)).body.days).toEqual([]);
  });

  it('falls back to simple reflection questions without the LLM', async () => {
    const saved = process.env.NEBIUS_API_KEY;
    delete process.env.NEBIUS_API_KEY;
    const { call, parentToken } = await setup();
    await call('POST', '/self/setup', parentToken, { name: 'Ali' });
    const r = await call('POST', '/self/reflect', parentToken, { appLabel: 'ReadEra', title: 'Meditations', minutes: 20 });
    expect(r.body.questions[0]).toMatch(/Meditations/);
    const saved2 = await call('POST', '/self/reflections', parentToken, { title: 'Meditations', questions: r.body.questions, answers: ['Control what you can.'] });
    expect(saved2).toMatchObject({ status: 201, body: { reply: null } });
    process.env.NEBIUS_API_KEY = saved;
  });

  it('coach tools set focus goals, limits and interests, and only offer to start focus', async () => {
    const repo = new Repo(db);
    const userId = randomUUID();
    const { subjectId } = await repo.setupSelf(userId, 'Ali');
    await repo.updateDevice(subjectId, {
      installedApps: [
        { packageName: 'org.readera', label: 'ReadEra' },
        { packageName: 'com.instagram.android', label: 'Instagram' },
      ],
    });
    const profile = (await repo.selfProfile(userId))!;
    const ctx = { userId, familyId: profile.familyId, subject: (await repo.getKid(profile.familyId, subjectId))!, profile };
    const actions: AgentAction[] = [];
    const client: any[] = [];

    await executeCoachTool(repo, ctx, 'set_focus_goal', { app: 'org.readera', title: 'Read', minutes: 20, required_before_apps: ['com.instagram.android'] }, actions, client);
    const goals: any = await executeCoachTool(repo, ctx, 'list_goals', {}, actions, client);
    expect(goals.goals).toMatchObject([{ kind: 'app', app: 'org.readera', minutes: 20 }]);
    expect(goals.rules).toMatchObject([{ apps: ['Instagram'], activity: 'task' }]);

    await executeCoachTool(repo, ctx, 'set_limit', { apps: ['com.instagram.android'], minutes_per_day: 30 }, actions, client);
    expect(await repo.listLimits(subjectId)).toEqual([{ packageName: 'com.instagram.android', dailyMinutes: 30 }]);
    await executeCoachTool(repo, ctx, 'add_interest', { topic: 'Stoicism' }, actions, client);
    expect((await repo.selfProfile(userId))!.interests).toEqual(['Stoicism']);

    await executeCoachTool(repo, ctx, 'start_focus', { app: 'org.readera', minutes: 15 }, actions, client);
    expect(client).toContainEqual({ type: 'start_focus', app: 'org.readera', label: 'ReadEra', minutes: 15 });
    await expect(executeCoachTool(repo, ctx, 'start_focus', { app: 'com.made.up', minutes: 5 }, actions, client)).rejects.toThrow(/Not installed/);
    expect(actions.every((a) => a.ok)).toBe(true);
  });
});
