import { describe, expect, it } from 'vitest';
import { evaluateGate, GeneratedChallenge, isPassing, paginate, type Rule } from '@mello/shared';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { Repo } from '../src/repo.ts';
import { executeTool, type AgentAction } from '../src/agent.ts';
import { extractJson, grade } from '../src/challenge.ts';

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  kidId: 'k1',
  apps: ['com.instagram.android'],
  minutesRequired: 5,
  unlockMinutes: 30,
  enabled: true,
  ...over,
});

describe('evaluateGate', () => {
  it('blocks covered apps', () => {
    expect(evaluateGate([rule()], 'com.instagram.android', {})).toMatchObject({ blocked: true });
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
  it('ignores disabled rules and picks the strictest rule', () => {
    const d = evaluateGate([rule({ minutesRequired: 1 }), rule({ id: 'r2', minutesRequired: 10 }), rule({ id: 'r3', minutesRequired: 60, enabled: false })], 'com.instagram.android', {});
    expect(d.blocked && d.rule.id).toBe('r2');
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

describe('paginate', () => {
  it('keeps paragraphs whole and splits long text', () => {
    const para = Array(100).fill('word').join(' ');
    const pages = paginate([para, para, para].join('\n\n'), 180);
    expect(pages).toHaveLength(3);
  });
});

describe('HTTP API', () => {
  const setup = async () => {
    const app = createApp(openDb(':memory:'));
    const call = async (method: string, path: string, token?: string, json?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: json === undefined ? undefined : JSON.stringify(json),
      });
      return { status: res.status, body: res.status === 204 ? null : await res.json() };
    };
    const family = (await call('POST', '/families', undefined, { name: 'Home' })).body;
    const kid = (await call('POST', '/pair', undefined, { code: family.pairingCode, kidName: 'Sara' })).body;
    return { call, family, kid };
  };

  it('pairs a kid, sets a rule and delivers it to the kid config', async () => {
    const { call, family, kid } = await setup();
    await call('PUT', '/kid/me/device', kid.deviceToken, {
      pushToken: null,
      installedApps: [{ packageName: 'com.zhiliaoapp.musically', label: 'TikTok' }],
    });
    const created = await call('POST', `/parent/kids/${kid.kidId}/rules`, family.parentToken, {
      apps: ['com.zhiliaoapp.musically'],
      minutesRequired: 5,
    });
    expect(created.status).toBe(201);
    expect(created.body.unlockMinutes).toBe(30);

    const config = await call('GET', '/kid/me/config', kid.deviceToken);
    expect(config.body.rules).toHaveLength(1);
    expect(config.body.kid.installedApps[0].label).toBe('TikTok');
  });

  it('keeps parent and kid tokens apart, and families apart', async () => {
    const { call, family, kid } = await setup();
    expect((await call('GET', '/kid/me/config', family.parentToken)).status).toBe(401);
    expect((await call('GET', '/parent/kids', kid.deviceToken)).status).toBe(401);

    const other = (await call('POST', '/families', undefined, { name: 'Other' })).body;
    expect((await call('GET', `/parent/kids/${kid.kidId}/rules`, other.parentToken)).status).toBe(404);
  });

  it('rejects a bad pairing code', async () => {
    const { call } = await setup();
    expect((await call('POST', '/pair', undefined, { code: '000000', kidName: 'X' })).status).toBe(404);
  });

  it('sends a text message that the kid can list and mark played', async () => {
    const { call, family, kid } = await setup();
    await call('POST', `/parent/kids/${kid.kidId}/messages`, family.parentToken, { text: 'Dinner in 10 minutes!' });
    const unplayed = await call('GET', '/kid/me/messages?unplayed=1', kid.deviceToken);
    expect(unplayed.body).toHaveLength(1);
    expect(unplayed.body[0]).toMatchObject({ kind: 'tts', text: 'Dinner in 10 minutes!' });
    await call('POST', `/kid/me/messages/${unplayed.body[0].id}/played`, kid.deviceToken);
    expect((await call('GET', '/kid/me/messages?unplayed=1', kid.deviceToken)).body).toHaveLength(0);
  });

  it('grades a stored challenge once, without leaking answers beforehand', async () => {
    const db = openDb(':memory:');
    const app = createApp(db);
    const repo = new Repo(db);
    const family = repo.createFamily('Home');
    const kid = repo.pairKid(family.pairingCode, 'Sara')!;
    const id = repo.saveChallenge(kid.id, null, {
      questions: [
        { question: 'Who?', choices: ['a', 'b', 'c', 'd'], answerIndex: 1 },
        { question: 'Where?', choices: ['a', 'b', 'c', 'd'], answerIndex: 2 },
        { question: 'Why?', choices: ['a', 'b', 'c', 'd'], answerIndex: 0 },
      ],
    });
    const answer = (answers: number[]) =>
      app.request(`/kid/challenges/${id}/answers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${kid.deviceToken}` },
        body: JSON.stringify({ answers }),
      });
    const res = await answer([1, 2, 3]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ passed: true, correct: 2, total: 3 });
    expect((await answer([1, 2, 0])).status).toBe(409);
  });

  it('returns 503 for challenges when the LLM key is missing', async () => {
    const saved = process.env.NEBIUS_API_KEY;
    delete process.env.NEBIUS_API_KEY;
    const { call, kid } = await setup();
    const res = await call('POST', '/kid/challenges', kid.deviceToken, { bookId: null, passage: 'x'.repeat(200) });
    expect(res.status).toBe(503);
    process.env.NEBIUS_API_KEY = saved;
  });
});

describe('agent tools', () => {
  it('sets a rule by kid name and refuses apps not on the phone', async () => {
    const repo = new Repo(openDb(':memory:'));
    const family = repo.createFamily('Home');
    const kid = repo.pairKid(family.pairingCode, 'Sara')!;
    repo.updateDevice(kid.id, null, [{ packageName: 'com.instagram.android', label: 'Instagram' }]);
    const actions: AgentAction[] = [];

    const rule: any = await executeTool(repo, family.id, 'set_reading_rule', { kid: 'sara', apps: ['com.instagram.android'], minutes_required: 3 }, actions);
    expect(rule.minutesRequired).toBe(3);
    expect(actions[0]).toMatchObject({ ok: true });

    await expect(
      executeTool(repo, family.id, 'set_reading_rule', { kid: 'Sara', apps: ['com.made.up'], minutes_required: 3 }, actions),
    ).rejects.toThrow(/Not installed/);
    await expect(executeTool(repo, family.id, 'list_apps', { kid: 'Nobody' }, actions)).rejects.toThrow(/No kid named/);
  });
});
