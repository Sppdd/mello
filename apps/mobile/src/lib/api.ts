import type {
  Alert,
  AppLimit,
  Book,
  BookInput,
  BookWithText,
  ChallengeResult,
  CharacterPrefs,
  ClientAction,
  SelfProfile,
  SelfProfileInput,
  Streak,
  UsageDay,
  DeviceStatus,
  InstalledApp,
  Kid,
  KidConfig,
  KidSettings,
  Message,
  PublicChallenge,
  QuietHours,
  Rule,
  RuleInput,
  Task,
  TaskInput,
  TaskProgress,
} from '@mello/shared';
import { parentAccessToken } from './supabase';

// Android emulators reach the host machine at 10.0.2.2. On a real phone set EXPO_PUBLIC_API_URL to your computer's LAN IP
// (or use `adb reverse tcp:8787 tcp:8787` and http://localhost:8787).
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8787';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

type Token = string | null | (() => Promise<string | null>);

async function request<T>(method: string, path: string, token: Token, body?: unknown): Promise<T> {
  const bearer = typeof token === 'function' ? await token() : token;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.code);
  return data as T;
}

export type Report = {
  days: number;
  sessions: number;
  minutesRead: number;
  challengesPassed: number;
  challengesFailed: number;
  minutesByDay: { day: string; minutes: number }[];
  unlocksByApp: { app: string; unlocks: number }[];
  tasks: { title: string; completedDays: number; minutes: number }[];
};
export type Family = { id: string; name: string; pairingCode: string; hasPassword: boolean };
export type UnpairRequest = { id: string; kidId: string; kidName: string; createdAt: string };
export type AgentTurn = { role: 'user' | 'assistant'; content: string };
export type AgentAction = { tool: string; ok: boolean; summary: string };
export type WeeklyInsight = { headline: string; wins: string[]; watch: string[]; nextSteps: { text: string; prompt: string }[]; model: string };
export type ContentKind = 'video' | 'article' | 'audio';
export type ContentPick = { kind: ContentKind; title: string; url: string; snippet: string; why: string; suggestedMinutes: number };
export type Location = { lat: number; lng: number; accuracyM: number | null; recordedAt: string };

/** Local calendar date on this phone, so "today" for tasks matches the kid's clock. */
export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const publicApi = {
  pair: (code: string, kidName: string) => request<{ kidId: string; deviceToken: string }>('POST', '/pair', null, { code, kidName }),
};

/** Parent calls authenticate with the signed-in Supabase user's access token. */
export const parentApi = () => {
  const t = parentAccessToken;
  const file = (uri: string, name: string, type: string) => ({ uri, name, type }) as unknown as Blob;
  return {
    family: () => request<Family>('GET', '/parent/family', t),
    createFamily: (name: string) => request<Family>('POST', '/parent/family', t, { name }),
    setPassword: (password: string) => request<{ ok: true }>('PUT', '/parent/password', t, { password }),
    unpairRequests: () => request<UnpairRequest[]>('GET', '/parent/unpair-requests', t),
    decideUnpair: (id: string, approve: boolean) => request<{ ok: true }>('POST', `/parent/unpair-requests/${id}`, t, { approve }),
    kids: () => request<Kid[]>('GET', '/parent/kids', t),
    updateSettings: (kidId: string, patch: Partial<KidSettings>) => request<Kid>('PATCH', `/parent/kids/${kidId}/settings`, t, patch),
    location: (kidId: string) => request<Location | null>('GET', `/parent/kids/${kidId}/location`, t),
    rules: (kidId: string) => request<Rule[]>('GET', `/parent/kids/${kidId}/rules`, t),
    addRule: (kidId: string, input: Partial<RuleInput> & Pick<RuleInput, 'apps' | 'minutesRequired'>) =>
      request<Rule>('POST', `/parent/kids/${kidId}/rules`, t, input),
    deleteRule: (ruleId: string) => request<void>('DELETE', `/parent/rules/${ruleId}`, t),
    tasks: (kidId: string) => request<Task[]>('GET', `/parent/kids/${kidId}/tasks`, t),
    addTask: (kidId: string, input: Partial<TaskInput> & Pick<TaskInput, 'kind' | 'title' | 'requiredMinutes'>) =>
      request<Task>('POST', `/parent/kids/${kidId}/tasks`, t, input),
    deleteTask: (taskId: string) => request<void>('DELETE', `/parent/tasks/${taskId}`, t),
    uploadAudio: (uri: string, name: string, type = 'audio/mpeg') => {
      const form = new FormData();
      form.append('audio', file(uri, name, type));
      return request<{ url: string }>('POST', '/parent/audio', t, form);
    },
    limits: (kidId: string) => request<AppLimit[]>('GET', `/parent/kids/${kidId}/limits`, t),
    setLimit: (kidId: string, limit: AppLimit) => request<AppLimit[]>('PUT', `/parent/kids/${kidId}/limits`, t, limit),
    deleteLimit: (kidId: string, pkg: string) => request<void>('DELETE', `/parent/kids/${kidId}/limits/${encodeURIComponent(pkg)}`, t),
    quietHours: (kidId: string) => request<QuietHours | null>('GET', `/parent/kids/${kidId}/quiet-hours`, t),
    setQuietHours: (kidId: string, q: QuietHours) => request<QuietHours>('PUT', `/parent/kids/${kidId}/quiet-hours`, t, q),
    alerts: () => request<Alert[]>('GET', '/parent/alerts', t),
    alertsSeen: () => request<{ ok: true }>('POST', '/parent/alerts/seen', t),
    books: () => request<Book[]>('GET', '/parent/books', t),
    addBook: (input: BookInput & { source?: 'pasted' | 'file' | 'sample' }) => request<Book>('POST', '/parent/books', t, input),
    assignBook: (kidId: string, bookId: string) => request<{ ok: true }>('PUT', `/parent/kids/${kidId}/book`, t, { bookId }),
    report: (kidId: string, days = 7) => request<Report>('GET', `/parent/kids/${kidId}/report?days=${days}`, t),
    messages: (kidId: string) => request<Message[]>('GET', `/parent/kids/${kidId}/messages`, t),
    sendText: (kidId: string, text: string) => request<{ id: string }>('POST', `/parent/kids/${kidId}/messages`, t, { text }),
    sendAudio: (kidId: string, uri: string) => {
      const form = new FormData();
      form.append('audio', file(uri, 'message.m4a', 'audio/mp4'));
      return request<{ id: string }>('POST', `/parent/kids/${kidId}/messages`, t, form);
    },
    insight: (kidId: string) => request<WeeklyInsight>('GET', `/parent/kids/${kidId}/insight`, t),
    contentIdeas: (kidId: string, topic: string, kind: ContentKind) =>
      request<ContentPick[]>('POST', `/parent/kids/${kidId}/content-ideas`, t, { topic, kind }),
    agent: (messages: AgentTurn[]) => request<{ reply: string; actions: AgentAction[] }>('POST', '/parent/agent/chat', t, { messages }),
  };
};

export const kidApi = (token: string) => ({
  config: () => request<KidConfig>('GET', `/kid/me/config?day=${localDay()}`, token),
  updateDevice: (d: { pushToken?: string | null; installedApps?: InstalledApp[] | null; status?: DeviceStatus | null }) =>
    request<{ ok: true }>('PUT', '/kid/me/device', token, d),
  taskProgress: (taskId: string, seconds: number) =>
    request<TaskProgress>('POST', `/kid/tasks/${taskId}/progress`, token, { day: localDay(), seconds }),
  location: (lat: number, lng: number, accuracyM: number | null) => request<{ ok: true }>('POST', '/kid/location', token, { lat, lng, accuracyM }),
  alert: (kind: 'bedtime_attempt' | 'limit_reached' | 'protection_off' | 'gate_bypass_attempt' | 'break_glass', detail: Record<string, unknown> = {}) =>
    request<{ ok: true }>('POST', '/kid/alerts', token, { kind, detail }),
  book: (bookId: string) => request<BookWithText>('GET', `/kid/books/${bookId}`, token),
  challenge: (bookId: string | null, passage: string) => request<PublicChallenge>('POST', '/kid/challenges', token, { bookId, passage }),
  answer: (challengeId: string, answers: number[]) =>
    request<ChallengeResult>('POST', `/kid/challenges/${challengeId}/answers`, token, { answers }),
  logSession: (s: { bookId?: string; taskId?: string; seconds: number; fromPage?: number; toPage?: number; appPackage?: string; challengeId?: string; passed?: boolean }) =>
    request<{ ok: true }>('POST', '/kid/sessions', token, s),
  setCharacter: (prefs: CharacterPrefs) => request<Kid>('PUT', '/kid/me/character', token, prefs),
  unplayedMessages: () => request<Message[]>('GET', '/kid/me/messages?unplayed=1', token),
  markPlayed: (id: string) => request<{ ok: boolean }>('POST', `/kid/me/messages/${id}/played`, token),
  unpairWithPassword: (password: string) => request<void>('POST', '/kid/unpair', token, { password }),
  requestUnpair: () => request<{ id: string; status: 'pending' }>('POST', '/kid/unpair-requests', token),
  unpairStatus: (id: string) => request<{ status: 'pending' | 'approved' | 'denied' }>('GET', `/kid/unpair-requests/${id}`, token),
});

/**
 * Self mode: the signed-in user coaching their own phone. Profile, usage and the coach use the
 * Supabase token; goals and limits go through the same /parent routes as a kid's, on the user's own subject.
 */
export const selfApi = () => {
  const t = parentAccessToken;
  return {
    setup: (name: string) => request<{ subjectId: string; deviceToken: string; profile: SelfProfile }>('POST', '/self/setup', t, { name }),
    profile: () => request<SelfProfile>('GET', '/self/profile', t),
    updateProfile: (patch: SelfProfileInput) => request<SelfProfile>('PUT', '/self/profile', t, patch),
    putUsage: (day: UsageDay) => request<void>('PUT', '/self/usage', t, day),
    usage: (days = 7) => request<{ days: UsageDay[]; streak: Streak }>('GET', `/self/usage?days=${days}&today=${localDay()}`, t),
    reflect: (s: { appLabel: string; title: string | null; minutes: number }) => request<{ questions: string[] }>('POST', '/self/reflect', t, s),
    saveReflection: (r: { title: string | null; questions: string[]; answers: string[] }) => request<{ reply: string | null }>('POST', '/self/reflections', t, r),
    coach: (messages: AgentTurn[]) => request<{ reply: string; actions: AgentAction[]; clientActions: ClientAction[] }>('POST', '/self/coach/chat', t, { messages }),
    deleteData: () => request<void>('DELETE', '/self/data', t),
    signOut: () => request<void>('POST', '/self/signout', t),
  };
};

/** The backend revoked this kid phone (a parent approved sign-out or the password was entered). */
export const isUnpaired = (err: unknown) => err instanceof ApiError && err.code === 'device_unpaired';
