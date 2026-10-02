import { z } from 'zod';

/**
 * Mello, the app's one character: a calm giant tortoise. "Small steps, big journeys."
 * Everyone gets the same Mello; what changes is the colour skin, the tone and (optionally) a nickname.
 * Lines are short on purpose (they show in a bubble and are read aloud).
 */

/** Kept as a one-value enum so settings saved by older builds ("pip", "sage", …) still parse, as Mello. */
export const CharacterId = z.enum(['mello']).catch('mello');
export type CharacterId = z.infer<typeof CharacterId>;

export const Skin = z.enum(['classic', 'lagoon', 'berry', 'sunny', 'night']);
export type Skin = z.infer<typeof Skin>;

export const Tone = z.enum(['gentle', 'balanced', 'firm']);
export type Tone = z.infer<typeof Tone>;

export const CharacterPrefs = z.object({
  characterId: CharacterId.default('mello'),
  skin: Skin.catch('classic').default('classic'),
  /** What the user calls Mello; defaults to "Mello". */
  nickname: z.string().trim().min(1).max(24).nullable().default(null),
  tone: Tone.default('balanced'),
  voiceOn: z.boolean().default(true),
});
export type CharacterPrefs = z.infer<typeof CharacterPrefs>;

export type CharacterEvent = 'greet' | 'bounce' | 'focus_start' | 'focus_done' | 'streak_up' | 'streak_risk' | 'guard_off' | 'break_glass';

/** Expressions Mello's art comes in. The first five match the character sheet. */
export const MOODS = ['happy', 'excited', 'content', 'curious', 'cheerful', 'proud', 'sleepy', 'worried', 'stern', 'focused'] as const;
export type Mood = (typeof MOODS)[number];

export type SkinColors = {
  /** Head, neck and legs. */
  skin: string;
  /** Lighter jaw and the nose-ridge plate. */
  plate: string;
  shell: string;
  /** Shell plate outlines. */
  shellLine: string;
  /** Accent for UI around Mello: name labels, bubble borders, the floating pill. */
  accent: string;
  ink: string;
};

export const SKINS: Record<Skin, { name: string; colors: SkinColors }> = {
  // The character sheet's own earthy palette.
  classic: { name: 'Classic', colors: { skin: '#8A8070', plate: '#D9C39A', shell: '#6E665A', shellLine: '#4A443B', accent: '#6B7F2E', ink: '#2A2620' } },
  lagoon: { name: 'Lagoon', colors: { skin: '#FFB37A', plate: '#FFF4E0', shell: '#14B8A6', shellLine: '#0F766E', accent: '#0F766E', ink: '#2B1B3D' } },
  berry: { name: 'Berry', colors: { skin: '#C9B6FF', plate: '#F3EDFF', shell: '#E0457B', shellLine: '#7A1F4A', accent: '#B8326A', ink: '#2B1B3D' } },
  sunny: { name: 'Sunny', colors: { skin: '#FFD66B', plate: '#FFF6D6', shell: '#FF6B5B', shellLine: '#B8392C', accent: '#C9402F', ink: '#3A2600' } },
  night: { name: 'Night', colors: { skin: '#9DB4FF', plate: '#E6ECFF', shell: '#2E3A8C', shellLine: '#1A2156', accent: '#3B4BB0', ink: '#141A3D' } },
};
export const SKIN_LIST = (Object.keys(SKINS) as Skin[]).map((id) => ({ id, ...SKINS[id] }));

export type Character = {
  id: CharacterId;
  name: string;
  species: string;
  tagline: string;
  personality: string;
  colors: SkinColors;
  /** expo-speech settings: a slow, warm voice. */
  voice: { pitch: number; rate: number };
  lines: Record<CharacterEvent, string[]>;
};

const MELLO: Omit<Character, 'colors'> = {
  id: 'mello',
  name: 'Mello',
  species: 'giant tortoise',
  tagline: 'Small steps, big journeys.',
  personality: 'calm, warm and steady, like a wise old friend; patient, never in a hurry; celebrates small steps; gently honest',
  voice: { pitch: 0.95, rate: 0.9 },
  lines: {
    greet: ['Hi {name}. One small step today?', 'Hello, {name}. Slow and steady, together.'],
    bounce: ['Let’s stay with {app} a little longer.', 'Back to {app}. Small steps.'],
    focus_start: ['{minutes} calm minutes in {app}. I’ll keep watch.'],
    focus_done: ['{minutes} minutes. That’s a real step.', 'Well done. Small steps, big journeys.'],
    streak_up: ['{streak} days in a row. Look how far we’ve come.'],
    streak_risk: ['Your {streak}-day path is waiting. One small step keeps it going.'],
    guard_off: ['I’ve tucked into my shell while I’m switched off. Wake me when you’re ready.'],
    break_glass: ['That’s okay. Even tortoises rest. See you soon.'],
  },
};

export function characterOf(prefs: Partial<CharacterPrefs> | null | undefined): Character {
  const skin = Skin.catch('classic').parse(prefs?.skin ?? 'classic');
  return { ...MELLO, colors: SKINS[skin].colors };
}

export function displayName(prefs: Partial<CharacterPrefs> | null | undefined): string {
  return prefs?.nickname?.trim() || MELLO.name;
}

/**
 * A line for an event, with {name}, {app}, {minutes}, {streak} filled in. `seed` picks a variant
 * deterministically (pass e.g. the day number) so the bubble doesn't flicker between lines.
 */
export function characterLine(prefs: Partial<CharacterPrefs> | null | undefined, event: CharacterEvent, vars: Record<string, string | number> = {}, seed = 0): string {
  const options = MELLO.lines[event];
  const line = options[Math.abs(seed) % options.length]!;
  return line.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : ''));
}

/** The persona half of a system prompt. The caller adds the task rules and context. */
export function personaPrompt(prefs: Partial<CharacterPrefs> | null | undefined, userName: string): string {
  const tone = prefs?.tone ?? 'balanced';
  const toneLine = {
    gentle: 'Be extra gentle: suggest, never push.',
    balanced: 'Be warm but honest: name the pattern, then suggest one step.',
    firm: 'Be direct and hold them to their own goals, but never insult or shame.',
  }[tone];
  const name = displayName(prefs);
  return `You are ${name}, a ${MELLO.species} and ${userName}'s personal habit companion. Personality: ${MELLO.personality}. Your motto: "${MELLO.tagline}" ${toneLine}
Speak as ${name} in the first person, in 1–3 short sentences. Never mention being an AI, a model, an agent, tools or functions.`;
}
