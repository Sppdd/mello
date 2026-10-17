import OpenAI from 'openai';
import {
  categoryFor,
  computeStreak,
  personaPrompt,
  RuleInput,
  TaskInput,
  type ClientAction,
  type Kid,
  type SelfProfile,
  type UsageDay,
} from '@mello/shared';
import { llm, LlmUnavailableError, MODELS, stripThinking } from './llm.ts';
import type { Repo } from './repo.ts';
import { extractJson } from './challenge.ts';
import { fn, runToolLoop, str, type AgentAction, type AgentTurn, type Tool } from './toolLoop.ts';

/**
 * The self-mode coach: the user's chosen character, helping them with their own phone habits.
 * It only sees daily aggregates (minutes and opens per app), goals and interests, never screen content.
 */

const GUIDELINES = `What you do: help the user notice their phone habits and swap endless scrolling for things they said they want (reading, listening, learning).
You can see daily app-use totals, their goals and interests. You can set daily app limits, set "spend N minutes in app X" goals (optionally required before other apps open), set a wind-down bedtime, remember interests, and offer to start a focus session now.
Guidelines:
- Be supportive and specific. Never shame, moralise or diagnose. No medical or clinical claims.
- Use real numbers from the usage summary when you talk about habits. If there's no data yet, say so.
- Use package names from list_apps exactly; never invent them. If an app isn't installed, suggest one by name instead.
- Ask one short question if a request is ambiguous.
- Before changing a goal or limit, make sure the user asked for it. To start a focus session, call start_focus; the phone asks the user to confirm.
- If interests are set and "always suggest" is on, end with one concrete suggestion (a book, podcast or topic) tied to an interest, when it fits.
- After changing something, say what changed in plain words.
- Write plain text for a phone screen: no markdown, no tables, no headings. Short lines; a simple "- " list is fine.`;

export type CoachContext = { userId: string; familyId: string; subject: Kid; profile: SelfProfile };

const tools: Tool[] = [
  fn('get_usage_summary', 'Daily app-use totals (minutes and opens per app, per category), unlocks, focus minutes and streak.', {
    days: { type: 'integer', description: 'Look-back window, 1-30, default 7' },
  }),
  fn('list_apps', 'Apps installed on the phone, with their category.', {}),
  fn('list_goals', 'Current limits, focus goals, rules and bedtime.', {}),
  fn(
    'set_limit',
    'Set a daily time limit for apps (0 blocks them for the day).',
    { apps: { type: 'array', items: { type: 'string' }, description: 'Package names from list_apps' }, minutes_per_day: { type: 'integer' } },
    ['apps', 'minutes_per_day'],
  ),
  fn('remove_limit', 'Remove the daily limit for an app.', { app: str('Package name') }, ['app']),
  fn(
    'set_focus_goal',
    'Daily goal: spend N minutes in an app (e.g. a reading or podcast app). Optionally other apps stay locked until it is done.',
    {
      app: str('Package name of the app to spend time in'),
      title: str('Short title, e.g. "Read in ReadEra"'),
      minutes: { type: 'integer', description: '1-180' },
      required_before_apps: { type: 'array', items: { type: 'string' }, description: 'Package names that wait until the goal is done today' },
    },
    ['app', 'title', 'minutes'],
  ),
  fn('remove_goal', 'Remove a focus goal (and any rule that depends on it).', { goal_id: str('Goal id from list_goals') }, ['goal_id']),
  fn(
    'set_bedtime',
    'Wind-down hours: only allowed apps open between start and end.',
    {
      start: str('HH:MM'),
      end: str('HH:MM'),
      allowed_apps: { type: 'array', items: { type: 'string' } },
      enabled: { type: 'boolean', description: 'false turns it off' },
    },
    ['start', 'end'],
  ),
  fn('add_interest', 'Remember a topic the user cares about.', { topic: str('e.g. "stoicism", "space history"') }, ['topic']),
  fn('remove_interest', 'Forget a topic.', { topic: str('Topic') }, ['topic']),
  fn(
    'start_focus',
    'Offer to start a focus session now: the phone opens the app and keeps the user there for N minutes. The user confirms on the phone.',
    { app: str('Package name'), minutes: { type: 'integer', description: '1-180' } },
    ['app', 'minutes'],
  ),
];

export async function runCoach(repo: Repo, ctx: CoachContext, history: AgentTurn[]) {
  const usage = await repo.usageDays(ctx.subject.id, 7);
  const system = `${personaPrompt(ctx.profile.character, ctx.profile.name)}\n\n${GUIDELINES}\n\nContext (JSON):\n${JSON.stringify({
    today: new Date().toISOString().slice(0, 10),
    interests: ctx.profile.interests,
    alwaysSuggest: ctx.profile.alwaysSuggest,
    usageLast7Days: summarize(usage),
    streak: streakOf(usage),
  })}`;
  const clientActions: ClientAction[] = [];
  const { reply, actions, finished } = await runToolLoop(
    system,
    tools,
    (name, args, actions) => executeCoachTool(repo, ctx, name, args, actions, clientActions),
    history,
    { temperature: 0.5 },
  );
  return { reply: finished ? reply : 'Hmm, I got tangled up there. Can you say that another way?', actions, clientActions };
}

export function streakOf(usage: UsageDay[], today = new Date().toISOString().slice(0, 10)) {
  return computeStreak(usage.map((u) => ({ day: u.day, guardOn: u.guardOn, goalMet: u.goalMet })), today);
}

/** Compact per-day view for the model: categories, top 5 apps, unlocks, focus. */
export function summarize(usage: UsageDay[]) {
  return usage.map((u) => ({
    day: u.day,
    categories: u.categories,
    topApps: u.apps.slice(0, 5).map((a) => `${a.label} ${a.minutes}m/${a.opens}x`),
    unlocks: u.unlocks,
    focusMinutes: u.focusMinutes,
    guardOnPct: Math.round(u.guardOn * 100),
  }));
}

export async function executeCoachTool(repo: Repo, ctx: CoachContext, name: string, args: any, actions: AgentAction[], clientActions: ClientAction[]): Promise<unknown> {
  const subject = (await repo.getKid(ctx.familyId, ctx.subject.id)) ?? ctx.subject;
  const label = (pkg: string) => subject.installedApps.find((a) => a.packageName === pkg)?.label ?? pkg;
  const checkApps = (apps: string[]) => {
    const known = new Set(subject.installedApps.map((a) => a.packageName));
    const unknown = apps.filter((p) => !known.has(p));
    if (known.size > 0 && unknown.length) throw new Error(`Not installed: ${unknown.join(', ')}`);
  };
  const hhmm = (v: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim());
    if (!m || +m[1]! > 23 || +m[2]! > 59) throw new Error(`Time must be HH:MM, got "${v}"`);
    return +m[1]! * 60 + +m[2]!;
  };
  const minutes = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));

  switch (name) {
    case 'get_usage_summary': {
      const usage = await repo.usageDays(subject.id, args.days ?? 7);
      return { days: summarize(usage), streak: streakOf(usage) };
    }
    case 'list_apps':
      return subject.installedApps.map((a) => ({ ...a, category: a.category ?? categoryFor(a.packageName) }));
    case 'list_goals': {
      const [limits, tasks, rules, bedtime] = await Promise.all([
        repo.listLimits(subject.id),
        repo.listTasks(subject.id, true),
        repo.listRules(subject.id),
        repo.getQuietHours(subject.id),
      ]);
      return {
        limits: limits.map((l) => ({ app: l.packageName, label: label(l.packageName), minutesPerDay: l.dailyMinutes })),
        goals: tasks.map((t) => ({ id: t.id, title: t.title, kind: t.kind, app: t.appPackage, minutes: t.requiredMinutes })),
        rules: rules.map((r) => ({ id: r.id, apps: r.apps.map(label), activity: r.activity, goalId: r.taskId, minutes: r.minutesRequired })),
        bedtime,
      };
    }
    case 'set_limit': {
      const apps: string[] = Array.isArray(args.apps) ? args.apps : [];
      if (!apps.length) throw new Error('Which apps?');
      checkApps(apps);
      const m = minutes(args.minutes_per_day, 1440);
      for (const app of apps) await repo.setLimit(subject.id, { packageName: app, dailyMinutes: m });
      actions.push({ tool: name, ok: true, summary: `${apps.map(label).join(', ')}: ${m} min a day` });
      clientActions.push({ type: 'refresh' });
      return { ok: true };
    }
    case 'remove_limit': {
      const ok = await repo.deleteLimit(subject.id, String(args.app));
      actions.push({ tool: name, ok, summary: ok ? `No more limit on ${label(args.app)}` : 'There was no limit on that app' });
      if (ok) clientActions.push({ type: 'refresh' });
      return { removed: ok };
    }
    case 'set_focus_goal': {
      checkApps([args.app]);
      const input = TaskInput.parse({ kind: 'app', title: String(args.title ?? `Time in ${label(args.app)}`).slice(0, 120), appPackage: args.app, requiredMinutes: minutes(args.minutes, 180) });
      const task = await repo.addTask(ctx.familyId, subject.id, input);
      const before: string[] = Array.isArray(args.required_before_apps) ? args.required_before_apps : [];
      if (before.length) {
        checkApps(before);
        await repo.addRule(subject.id, RuleInput.parse({ apps: before, activity: 'task', taskId: task.id, minutesRequired: Math.min(task.requiredMinutes, 120) }));
      }
      actions.push({ tool: name, ok: true, summary: `${task.requiredMinutes} min in ${label(args.app)} daily${before.length ? ` before ${before.map(label).join(', ')}` : ''}` });
      clientActions.push({ type: 'refresh' });
      return { id: task.id };
    }
    case 'remove_goal': {
      const ok = await repo.deleteTask(ctx.familyId, String(args.goal_id));
      actions.push({ tool: name, ok, summary: ok ? 'Goal removed' : 'Goal not found' });
      if (ok) clientActions.push({ type: 'refresh' });
      return { removed: ok };
    }
    case 'set_bedtime': {
      const allowed: string[] = Array.isArray(args.allowed_apps) ? args.allowed_apps : [];
      checkApps(allowed);
      await repo.setQuietHours(subject.id, { enabled: args.enabled ?? true, startMinute: hhmm(args.start), endMinute: hhmm(args.end), allowedApps: allowed });
      actions.push({ tool: name, ok: true, summary: args.enabled === false ? 'Wind-down off' : `Wind-down ${args.start}–${args.end}` });
      clientActions.push({ type: 'refresh' });
      return { ok: true };
    }
    case 'add_interest':
    case 'remove_interest': {
      const topic = String(args.topic ?? '').trim().slice(0, 60);
      if (!topic) throw new Error('Topic is empty');
      const current = ctx.profile.interests.filter((t) => t.toLowerCase() !== topic.toLowerCase());
      const interests = name === 'add_interest' ? [...current, topic].slice(-20) : current;
      await repo.updateSelfProfile(ctx.userId, { interests });
      ctx.profile.interests = interests;
      actions.push({ tool: name, ok: true, summary: name === 'add_interest' ? `Interested in ${topic}` : `Forgot ${topic}` });
      return { interests };
    }
    case 'start_focus': {
      checkApps([args.app]);
      const m = Math.max(1, minutes(args.minutes, 180));
      clientActions.push({ type: 'start_focus', app: args.app, label: label(args.app), minutes: m });
      return { offered: true, note: 'The phone will ask the user to confirm.' };
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

// ---------- Reflection after a focus session ----------

const REFLECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: { questions: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } } },
};

/** 1–2 open questions about what the user just read or heard. Never fails: falls back to generic ones. */
export async function reflectionQuestions(profile: SelfProfile, s: { appLabel: string; title: string | null; minutes: number }): Promise<string[]> {
  const fallback = s.title
    ? [`What stayed with you from ${s.title}?`, 'Is there one idea you want to try or remember?']
    : ['What did you read or listen to just now?', 'What stayed with you?'];
  try {
    const res = await llm().chat.completions.create({
      model: MODELS.fast,
      temperature: 0.7,
      response_format: { type: 'json_schema', json_schema: { name: 'reflection', strict: true, schema: REFLECT_SCHEMA } },
      messages: [
        {
          role: 'system',
          content: `${personaPrompt(profile.character, profile.name)}
Write 1 or 2 short, open reflection questions (under 18 words each) for someone who just spent ${s.minutes} minutes in ${s.appLabel}${s.title ? ` with "${s.title}"` : ''}.
Make them about what they took away, not a test. If you know the work, you may reference its themes. Reply as JSON: {"questions":["..."]}`,
        },
        { role: 'user', content: 'Ask me.' },
      ],
    });
    const parsed = JSON.parse(extractJson(res.choices[0]?.message?.content ?? ''));
    const qs = (parsed.questions as unknown[]).filter((q): q is string => typeof q === 'string' && q.length > 3).slice(0, 2);
    return qs.length ? qs : fallback;
  } catch (err) {
    if (err instanceof LlmUnavailableError || err instanceof OpenAI.APIError || err instanceof SyntaxError || err instanceof TypeError) return fallback;
    throw err;
  }
}

/** The character's short reply to the user's answers. null if the model is unavailable. */
export async function reflectionReply(profile: SelfProfile, questions: string[], answers: string[]): Promise<string | null> {
  try {
    const res = await llm().chat.completions.create({
      model: MODELS.fast,
      temperature: 0.7,
      messages: [
        { role: 'system', content: `${personaPrompt(profile.character, profile.name)}\nReply to their reflection in 1–2 sentences: notice something specific they said. No questions back.` },
        { role: 'user', content: questions.map((q, i) => `Q: ${q}\nA: ${answers[i] ?? ''}`).join('\n\n') },
      ],
    });
    return stripThinking(res.choices[0]?.message?.content) || null;
  } catch (err) {
    if (err instanceof LlmUnavailableError || err instanceof OpenAI.APIError) return null;
    throw err;
  }
}
