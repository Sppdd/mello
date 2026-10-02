import { z } from 'zod';

// ---------- Domain ----------

export const InstalledApp = z.object({
  packageName: z.string(),
  label: z.string(),
});
export type InstalledApp = z.infer<typeof InstalledApp>;

/**
 * "To open any of `apps`, first read for `minutesRequired` (activity 'reading') or finish task
 * `taskId` (activity 'task'); the app then stays open for `unlockMinutes`."
 */
export const Rule = z.object({
  id: z.string(),
  kidId: z.string(),
  apps: z.array(z.string()).min(1),
  activity: z.enum(['reading', 'task']),
  taskId: z.string().nullable(),
  minutesRequired: z.number().int().min(1).max(120),
  unlockMinutes: z.number().int().min(1).max(240),
  enabled: z.boolean(),
});
export type Rule = z.infer<typeof Rule>;

export const RuleInput = Rule.omit({ id: true, kidId: true })
  .extend({
    enabled: z.boolean().default(true),
    unlockMinutes: z.number().int().min(1).max(240).default(30),
    activity: z.enum(['reading', 'task']).default('reading'),
    taskId: z.string().nullable().default(null),
  })
  .refine((r) => r.activity === 'reading' || !!r.taskId, { message: 'A task rule needs a taskId', path: ['taskId'] });
export type RuleInput = z.infer<typeof RuleInput>;

/** Opt-in extras a parent switches on per kid. All off by default. */
export const KidSettings = z.object({
  /** Share the phone's location with the parent while Mello is running. */
  location: z.boolean().default(false),
  /** Ask for a photo of the book page as proof of reading. */
  photoProof: z.boolean().default(false),
  /** Only count reading/listening time while the phone is held and the screen is on. */
  attentionChecks: z.boolean().default(true),
});
export type KidSettings = z.infer<typeof KidSettings>;

/** What the kid's phone last reported about itself. */
export const DeviceStatus = z.object({
  gateEnabled: z.boolean().optional(),
  overlayEnabled: z.boolean().optional(),
  usageAccessEnabled: z.boolean().optional(),
  deviceAdminEnabled: z.boolean().optional(),
  batteryPercent: z.number().min(0).max(100).optional(),
  appVersion: z.string().max(40).optional(),
});
export type DeviceStatus = z.infer<typeof DeviceStatus>;

export const Kid = z.object({
  id: z.string(),
  name: z.string(),
  currentBookId: z.string().nullable(),
  installedApps: z.array(InstalledApp),
  settings: KidSettings,
  deviceStatus: DeviceStatus,
  lastSeenAt: z.string().nullable(),
});
export type Kid = z.infer<typeof Kid>;

// ---------- Tasks: parent-assigned activities ----------

export const TaskKind = z.enum(['audio', 'video', 'article', 'reading']);
export type TaskKind = z.infer<typeof TaskKind>;

export const Task = z.object({
  id: z.string(),
  kidId: z.string(),
  kind: TaskKind,
  title: z.string(),
  url: z.string().nullable(),
  bookId: z.string().nullable(),
  requiredMinutes: z.number().int().min(1).max(180),
  repeat: z.enum(['once', 'daily']),
  active: z.boolean(),
});
export type Task = z.infer<typeof Task>;

export const TaskInput = z
  .object({
    kind: TaskKind,
    title: z.string().min(1).max(120),
    url: z.url({ protocol: /^https?$/ }).nullable().default(null),
    bookId: z.string().nullable().default(null),
    requiredMinutes: z.number().int().min(1).max(180),
    repeat: z.enum(['once', 'daily']).default('daily'),
  })
  .refine((t) => t.kind === 'reading' || !!t.url, { message: 'Audio, video and article tasks need a URL', path: ['url'] })
  .refine((t) => t.kind !== 'video' || !t.url || youtubeId(t.url) !== null, { message: 'Video tasks must be a YouTube link', path: ['url'] });
export type TaskInput = z.infer<typeof TaskInput>;

/** Today's progress on a task, in seconds of verified activity. */
export const TaskProgress = z.object({
  taskId: z.string(),
  seconds: z.number().int(),
  completed: z.boolean(),
});
export type TaskProgress = z.infer<typeof TaskProgress>;

/** Extracts the 11-char video id from the usual YouTube URL shapes. */
export function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1]! : null;
}

// ---------- Limits & bedtime ----------

export const AppLimit = z.object({
  packageName: z.string().min(1),
  dailyMinutes: z.number().int().min(0).max(1440),
});
export type AppLimit = z.infer<typeof AppLimit>;

export const QuietHours = z.object({
  enabled: z.boolean(),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
  allowedApps: z.array(z.string()),
});
export type QuietHours = z.infer<typeof QuietHours>;

/** Is `minuteOfDay` inside the window? Handles windows that cross midnight (e.g. 21:00–07:00). */
export function inQuietHours(q: QuietHours | null, minuteOfDay: number): boolean {
  if (!q?.enabled || q.startMinute === q.endMinute) return false;
  return q.startMinute < q.endMinute
    ? minuteOfDay >= q.startMinute && minuteOfDay < q.endMinute
    : minuteOfDay >= q.startMinute || minuteOfDay < q.endMinute;
}

export const Alert = z.object({
  id: z.string(),
  kidId: z.string(),
  kidName: z.string(),
  kind: z.string(),
  detail: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type Alert = z.infer<typeof Alert>;

export const Book = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string().nullable(),
  ageLevel: z.number().int().nullable(),
});
export type Book = z.infer<typeof Book>;

export const BookWithText = Book.extend({ text: z.string() });
export type BookWithText = z.infer<typeof BookWithText>;

export const BookInput = z.object({
  title: z.string().min(1),
  author: z.string().optional(),
  ageLevel: z.number().int().min(3).max(18).optional(),
  text: z.string().min(200, 'Book text is too short to build reading challenges'),
});
export type BookInput = z.infer<typeof BookInput>;

// ---------- Challenges ----------

/** What the LLM must return. Multiple choice so grading is deterministic and works for young readers. */
export const GeneratedQuestion = z.object({
  question: z.string().min(3),
  choices: z.array(z.string().min(1)).length(4),
  answerIndex: z.number().int().min(0).max(3),
});
export const GeneratedChallenge = z.object({
  questions: z.array(GeneratedQuestion).min(2).max(3),
});
export type GeneratedChallenge = z.infer<typeof GeneratedChallenge>;

/** What the kid's phone sees — answers stay on the server. */
export const PublicChallenge = z.object({
  challengeId: z.string(),
  questions: z.array(GeneratedQuestion.omit({ answerIndex: true })),
});
export type PublicChallenge = z.infer<typeof PublicChallenge>;

export const ChallengeResult = z.object({
  passed: z.boolean(),
  correct: z.number().int(),
  total: z.number().int(),
  correctAnswers: z.array(z.number().int()),
});
export type ChallengeResult = z.infer<typeof ChallengeResult>;

/** Pass mark: at least 2 of 3 (or 2 of 2). */
export function isPassing(correct: number, total: number): boolean {
  return total > 0 && correct >= Math.min(total, Math.ceil((total * 2) / 3));
}

// ---------- Messages ----------

export const Message = z.object({
  id: z.string(),
  kidId: z.string(),
  kind: z.enum(['audio', 'tts']),
  text: z.string().nullable(),
  audioUrl: z.string().nullable(),
  createdAt: z.string(),
  playedAt: z.string().nullable(),
});
export type Message = z.infer<typeof Message>;

// ---------- Kid config ----------

export const KidConfig = z.object({
  kid: Kid,
  rules: z.array(Rule),
  currentBook: Book.nullable(),
  tasks: z.array(Task),
  taskProgress: z.array(TaskProgress),
  limits: z.array(AppLimit),
  quietHours: QuietHours.nullable(),
});
export type KidConfig = z.infer<typeof KidConfig>;

// ---------- Gate logic (shared by JS on the phone and by tests) ----------

/** Apps Mello must never block, whatever the parent sets. */
export const NEVER_BLOCK = new Set([
  'com.mello.app',
  'com.android.dialer',
  'com.google.android.dialer',
  'com.android.phone',
  'com.android.emergency',
  'com.google.android.apps.safetyhub',
  'com.android.settings',
]);

export type Unlocks = Record<string, number>; // packageName -> unlocked-until (epoch ms)

export type GateDecision =
  | { blocked: false; reason: 'not-covered' | 'unlocked' | 'protected' }
  | { blocked: true; reason: 'rule'; rule: Rule }
  | { blocked: true; reason: 'bedtime'; until: number }
  | { blocked: true; reason: 'limit'; limitMinutes: number };

export type GateContext = {
  rules: Rule[];
  quietHours?: QuietHours | null;
  limits?: AppLimit[];
  /** Minutes each app has been in the foreground today (from UsageStats). */
  usageToday?: Record<string, number>;
};

/**
 * What stands between the kid and `packageName` right now. Order matters: bedtime beats everything,
 * then a used-up daily limit, then read/task-first rules (which an unlock satisfies for a while).
 */
export function evaluateGate(ctx: GateContext | Rule[], packageName: string, unlocks: Unlocks, now = Date.now()): GateDecision {
  const { rules, quietHours = null, limits = [], usageToday = {} } = Array.isArray(ctx) ? { rules: ctx } : ctx;
  if (NEVER_BLOCK.has(packageName)) return { blocked: false, reason: 'protected' };

  const date = new Date(now);
  const minuteOfDay = date.getHours() * 60 + date.getMinutes();
  if (inQuietHours(quietHours, minuteOfDay) && !quietHours!.allowedApps.includes(packageName)) {
    const minutesLeft = (quietHours!.endMinute - minuteOfDay + 1440) % 1440;
    return { blocked: true, reason: 'bedtime', until: now + minutesLeft * 60_000 };
  }

  const limit = limits.find((l) => l.packageName === packageName);
  if (limit && (usageToday[packageName] ?? 0) >= limit.dailyMinutes) {
    return { blocked: true, reason: 'limit', limitMinutes: limit.dailyMinutes };
  }

  const matching = rules.filter((r) => r.enabled && r.apps.includes(packageName));
  if (matching.length === 0) return { blocked: false, reason: 'not-covered' };
  if ((unlocks[packageName] ?? 0) > now) return { blocked: false, reason: 'unlocked' };
  // A task rule is the parent's explicit ask, so it wins; otherwise the strictest reading rule.
  const task = matching.find((r) => r.activity === 'task');
  const rule = task ?? matching.reduce((a, b) => (b.minutesRequired > a.minutesRequired ? b : a));
  return { blocked: true, reason: 'rule', rule };
}

/** Minutes left today for an app with a limit, or null if it has none. */
export function minutesLeft(limits: AppLimit[], usageToday: Record<string, number>, packageName: string): number | null {
  const limit = limits.find((l) => l.packageName === packageName);
  return limit ? Math.max(0, limit.dailyMinutes - (usageToday[packageName] ?? 0)) : null;
}

/** Split book text into reader pages of roughly `wordsPerPage` words, keeping paragraphs intact where possible. */
export function paginate(text: string, wordsPerPage = 180): string[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const pages: string[] = [];
  let current: string[] = [];
  let count = 0;
  for (const p of paragraphs) {
    const words = p.split(/\s+/).length;
    if (count > 0 && count + words > wordsPerPage) {
      pages.push(current.join('\n\n'));
      current = [];
      count = 0;
    }
    current.push(p);
    count += words;
  }
  if (current.length) pages.push(current.join('\n\n'));
  return pages;
}
