import { z } from 'zod';

// ---------- Domain ----------

export const InstalledApp = z.object({
  packageName: z.string(),
  label: z.string(),
});
export type InstalledApp = z.infer<typeof InstalledApp>;

/** "To open any of `apps`, read for `minutesRequired`, then the app stays open for `unlockMinutes`." */
export const Rule = z.object({
  id: z.string(),
  kidId: z.string(),
  apps: z.array(z.string()).min(1),
  minutesRequired: z.number().int().min(1).max(120),
  unlockMinutes: z.number().int().min(1).max(240),
  enabled: z.boolean(),
});
export type Rule = z.infer<typeof Rule>;

export const RuleInput = Rule.omit({ id: true, kidId: true }).extend({
  enabled: z.boolean().default(true),
  unlockMinutes: z.number().int().min(1).max(240).default(30),
});
export type RuleInput = z.infer<typeof RuleInput>;

export const Kid = z.object({
  id: z.string(),
  name: z.string(),
  currentBookId: z.string().nullable(),
  installedApps: z.array(InstalledApp),
});
export type Kid = z.infer<typeof Kid>;

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
  | { blocked: true; rule: Rule };

export function evaluateGate(rules: Rule[], packageName: string, unlocks: Unlocks, now = Date.now()): GateDecision {
  if (NEVER_BLOCK.has(packageName)) return { blocked: false, reason: 'protected' };
  const matching = rules.filter((r) => r.enabled && r.apps.includes(packageName));
  if (matching.length === 0) return { blocked: false, reason: 'not-covered' };
  if ((unlocks[packageName] ?? 0) > now) return { blocked: false, reason: 'unlocked' };
  // Strictest rule wins when several cover the same app.
  const rule = matching.reduce((a, b) => (b.minutesRequired > a.minutesRequired ? b : a));
  return { blocked: true, rule };
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
