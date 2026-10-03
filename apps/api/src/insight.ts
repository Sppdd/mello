import type { Kid } from '@mello/shared';
import { llm, MODELS, stripThinking } from './llm.ts';
import { extractJson } from './challenge.ts';
import type { Repo } from './repo.ts';

/**
 * The parent's weekly insight: Nemotron 3 Ultra reasons over a week of one kid's reading, tasks, quiz results,
 * limits and alerts, and writes what went well, what to watch, and a few concrete next steps.
 * Input is aggregates only (minutes, counts, app names); no screen content ever exists to send.
 */

export type WeeklyInsight = {
  headline: string;
  wins: string[];
  watch: string[];
  nextSteps: { text: string; prompt: string }[];
  model: string;
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'wins', 'watch', 'nextSteps'],
  properties: {
    headline: { type: 'string' },
    wins: { type: 'array', maxItems: 3, items: { type: 'string' } },
    watch: { type: 'array', maxItems: 3, items: { type: 'string' } },
    nextSteps: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'prompt'],
        properties: { text: { type: 'string' }, prompt: { type: 'string' } },
      },
    },
  },
};

const SYSTEM = `You are Mello, a calm, practical helper for parents. You get one week of data about one child's phone habits
in a family app where kids read or finish parent-set tasks before fun apps open.
Think carefully about patterns (trends across days, quiz pass rate, tasks skipped, limits hit, protection switched off),
then write for a busy parent:
- headline: one sentence, specific, with a real number.
- wins: up to 3 short, specific positives (use numbers).
- watch: up to 3 things to keep an eye on, never alarming or shaming; skip if nothing stands out.
- nextSteps: up to 3 concrete actions. "text" is what the parent reads; "prompt" is an instruction the parent could send
  to Mello's agent to do it, e.g. "Make Sara read 10 minutes before YouTube".
If there's little data, say so plainly and suggest a first step. No medical or clinical claims. Reply as JSON only.`;

export async function weeklyInsight(repo: Repo, familyId: string, kid: Kid): Promise<WeeklyInsight> {
  const [report, rules, tasks, limits, quiet, alerts] = await Promise.all([
    repo.report(kid.id, 7),
    repo.listRules(kid.id),
    repo.listTasks(kid.id),
    repo.listLimits(kid.id),
    repo.getQuietHours(kid.id),
    repo.listAlerts(familyId, false),
  ]);
  const label = (pkg: string) => kid.installedApps.find((a) => a.packageName === pkg)?.label ?? pkg;
  const data = {
    kid: { name: kid.name, age: kid.settings.age ?? null, lastSeenAt: kid.lastSeenAt, protection: kid.deviceStatus },
    week: { ...report, unlocksByApp: report.unlocksByApp.map((u) => ({ app: label(u.app), unlocks: u.unlocks })) },
    rules: rules.map((r) => ({ apps: r.apps.map(label), activity: r.activity, minutes: r.minutesRequired })),
    tasks: tasks.map((t) => ({ title: t.title, kind: t.kind, minutes: t.requiredMinutes, repeat: t.repeat })),
    limits: limits.map((l) => ({ app: label(l.packageName), minutesPerDay: l.dailyMinutes })),
    bedtime: quiet,
    alerts: alerts.filter((a) => a.kidId === kid.id).slice(0, 15).map((a) => ({ kind: a.kind, at: a.createdAt })),
  };
  const res = await llm().chat.completions.create({
    model: MODELS.reasoning,
    temperature: 0.3,
    max_tokens: 4000,
    response_format: { type: 'json_schema', json_schema: { name: 'weekly_insight', strict: true, schema: SCHEMA } },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify(data) },
    ],
  });
  const parsed = JSON.parse(extractJson(stripThinking(res.choices[0]?.message?.content))) as Omit<WeeklyInsight, 'model'>;
  return {
    headline: String(parsed.headline ?? ''),
    wins: (parsed.wins ?? []).slice(0, 3),
    watch: (parsed.watch ?? []).slice(0, 3),
    nextSteps: (parsed.nextSteps ?? []).slice(0, 3),
    model: MODELS.reasoning,
  };
}
