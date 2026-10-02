import { characterLine, GUARD_ON_THRESHOLD, type AppCategory, type KidConfig, type Task, type UsageDay } from '@mello/shared';
import { MelloBlocker, type FocusResult } from '../../modules/mello-blocker';
import { kidApi, localDay, selfApi } from './api';
import { readJson, writeJson } from './cache';

/**
 * Self mode on the phone. Raw usage events stay here; only the daily totals built below are
 * uploaded (top 15 apps, minutes per category, unlocks, guard-on share).
 */

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export async function buildUsageDay(config: KidConfig, date = new Date()): Promise<UsageDay> {
  const from = dayStart(date);
  const to = from + 86_400_000;
  const isToday = localDay(date) === localDay();
  const usage = await MelloBlocker.getUsageBetween(from, to);
  const known = new Map(config.kid.installedApps.map((a) => [a.packageName, a]));
  // Only launchable apps: skips the launcher, system UI and Mello itself.
  const apps = usage.apps
    .filter((a) => known.has(a.packageName) && (a.minutes > 0 || a.opens > 0))
    .map((a) => {
      const app = known.get(a.packageName)!;
      return { packageName: a.packageName, label: app.label.slice(0, 80), category: app.category ?? ('other' as AppCategory), minutes: a.minutes, opens: a.opens };
    })
    .sort((a, b) => b.minutes - a.minutes || b.opens - a.opens);
  const categories: UsageDay['categories'] = {};
  for (const a of apps) categories[a.category] = (categories[a.category] ?? 0) + a.minutes;

  const guard = MelloBlocker.getGuardStatus();
  const gateOn = MelloBlocker.isServiceEnabled();
  // Share of screen-on time the guard was running. Past days use what we cached that day.
  const guardOn = isToday
    ? usage.screenOnMinutes > 0
      ? Math.min(1, guard.guardMinutesToday / usage.screenOnMinutes)
      : gateOn
        ? 1
        : 0
    : (readJson<Partial<UsageDay>>(`usage-${localDay(date)}`, {}).guardOn ?? 0);

  const focus = readJson<Record<string, number>>('focus-minutes', {});
  const day: UsageDay = {
    day: localDay(date),
    apps: apps.slice(0, 15),
    categories,
    unlocks: usage.unlocks,
    guardOn: Math.round(guardOn * 100) / 100,
    focusMinutes: focus[localDay(date)] ?? 0,
    breakGlass: isToday ? guard.breakGlassToday : (readJson<Partial<UsageDay>>(`usage-${localDay(date)}`, {}).breakGlass ?? 0),
    goalMet: goalMet(config, apps, isToday),
  };
  return day;
}

/** A focus/reading task done today, or (with no tasks) every daily limit respected. */
function goalMet(config: KidConfig, apps: { packageName: string; minutes: number }[], isToday: boolean): boolean {
  // Past days are only known from what was cached that day; uploadUsage fills them in.
  if (!isToday) return false;
  if (config.taskProgress.some((p) => p.completed)) return true;
  if (config.tasks.length === 0 && config.limits.length > 0) {
    return config.limits.every((l) => (apps.find((a) => a.packageName === l.packageName)?.minutes ?? 0) <= l.dailyMinutes);
  }
  return false;
}

/** Uploads today's totals, and yesterday's final ones once the day has rolled over. */
export async function uploadUsage(config: KidConfig) {
  if (!MelloBlocker.isUsageAccessGranted()) return;
  const api = selfApi();
  const today = await buildUsageDay(config);
  writeJson(`usage-${today.day}`, today);
  writeJson('goal-met', { day: today.day, met: today.goalMet });
  await api.putUsage(today);
  const last = readJson<string | null>('usage-final-uploaded', null);
  const yesterday = new Date(Date.now() - 86_400_000);
  if (last !== localDay(yesterday)) {
    const cached = readJson<UsageDay | null>(`usage-${localDay(yesterday)}`, null);
    if (cached) {
      const fresh = await buildUsageDay(config, yesterday);
      await api.putUsage({ ...fresh, guardOn: cached.guardOn, breakGlass: cached.breakGlass, goalMet: cached.goalMet });
    }
    writeJson('usage-final-uploaded', localDay(yesterday));
  }
}

export const guardHealthy = (u: UsageDay | null) => !!u && u.guardOn >= GUARD_ON_THRESHOLD;

// ---------- focus sessions ----------

type FocusMeta = { taskId: string | null; title: string | null };

/** Starts the focus lock and opens the app. `gatedApp` opens afterwards if the session completes. */
export function startFocus(app: { packageName: string; label: string }, minutes: number, opts: { taskId?: string | null; gatedApp?: string | null } = {}) {
  writeJson('focus-meta', { taskId: opts.taskId ?? null, title: null } satisfies FocusMeta);
  MelloBlocker.startFocus(app.packageName, app.label, minutes, opts.gatedApp ?? null);
  return MelloBlocker.launchApp(app.packageName);
}

/**
 * Records a finished (or abandoned) session: the session row, task progress in ≤5-minute steps,
 * today's focus minutes, and the unlock for the app that was waiting on it.
 */
export async function recordFocus(token: string, config: KidConfig | null, result: FocusResult) {
  const api = kidApi(token);
  const meta = readJson<FocusMeta>('focus-meta', { taskId: null, title: null });
  const seconds = Math.round(result.elapsedMs / 1000);
  const focus = readJson<Record<string, number>>('focus-minutes', {});
  focus[localDay()] = (focus[localDay()] ?? 0) + Math.round(seconds / 60);
  writeJson('focus-minutes', focus);

  await api.logSession({ taskId: meta.taskId ?? undefined, seconds, appPackage: result.gatedApp ?? result.target, passed: result.completed }).catch(() => {});
  if (meta.taskId) {
    for (let left = seconds; left > 0; left -= 300) await api.taskProgress(meta.taskId, Math.min(300, left)).catch(() => {});
  }
  if (result.reason === 'break_glass') {
    const why = readJson<string>('break-glass-why', '');
    writeJson('break-glass-why', '');
    await api.alert('break_glass', { app: result.target, minutes: Math.round(seconds / 60), why }).catch(() => {});
  }
  if (result.completed && result.gatedApp) {
    const rule = config?.rules.find((r) => r.enabled && r.apps.includes(result.gatedApp!));
    MelloBlocker.unlock(result.gatedApp, rule?.unlockMinutes ?? 30);
  }
}

/** The task a read-first rule points at, when it's an app task. */
export function appTaskFor(config: KidConfig | null, gatedApp: string): Task | null {
  const rule = config?.rules.find((r) => r.enabled && r.activity === 'task' && r.apps.includes(gatedApp));
  const task = rule && config?.tasks.find((t) => t.id === rule.taskId);
  return task && task.kind === 'app' ? task : null;
}

/** Minutes still needed today on a task. */
export function minutesLeftOn(config: KidConfig | null, task: Task) {
  const p = config?.taskProgress.find((x) => x.taskId === task.id);
  return Math.max(1, Math.ceil(task.requiredMinutes - (p?.seconds ?? 0) / 60));
}

export function greeting(config: KidConfig) {
  return characterLine(config.kid.settings.character, 'greet', { name: config.kid.name }, new Date().getDate());
}
