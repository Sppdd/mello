import type {
  Book,
  BookInput,
  BookWithText,
  ChallengeResult,
  InstalledApp,
  Kid,
  KidConfig,
  Message,
  PublicChallenge,
  Rule,
  RuleInput,
} from '@mello/shared';

// Android emulators reach the host machine at 10.0.2.2. On a real phone set EXPO_PUBLIC_API_URL to your computer's LAN IP.
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

async function request<T>(method: string, path: string, token: string | null, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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
};
export type AgentTurn = { role: 'user' | 'assistant'; content: string };
export type AgentAction = { tool: string; ok: boolean; summary: string };

export const publicApi = {
  createFamily: (name: string) =>
    request<{ id: string; parentToken: string; pairingCode: string }>('POST', '/families', null, { name }),
  pair: (code: string, kidName: string) => request<{ kidId: string; deviceToken: string }>('POST', '/pair', null, { code, kidName }),
};

export const parentApi = (token: string) => ({
  family: () => request<{ id: string; name: string; pairingCode: string }>('GET', '/parent/family', token),
  kids: () => request<Kid[]>('GET', '/parent/kids', token),
  rules: (kidId: string) => request<Rule[]>('GET', `/parent/kids/${kidId}/rules`, token),
  addRule: (kidId: string, input: Partial<RuleInput> & Pick<RuleInput, 'apps' | 'minutesRequired'>) =>
    request<Rule>('POST', `/parent/kids/${kidId}/rules`, token, input),
  deleteRule: (ruleId: string) => request<void>('DELETE', `/parent/rules/${ruleId}`, token),
  books: () => request<Book[]>('GET', '/parent/books', token),
  addBook: (input: BookInput) => request<Book>('POST', '/parent/books', token, input),
  assignBook: (kidId: string, bookId: string) => request<{ ok: true }>('PUT', `/parent/kids/${kidId}/book`, token, { bookId }),
  report: (kidId: string, days = 7) => request<Report>('GET', `/parent/kids/${kidId}/report?days=${days}`, token),
  messages: (kidId: string) => request<Message[]>('GET', `/parent/kids/${kidId}/messages`, token),
  sendText: (kidId: string, text: string) => request<{ id: string }>('POST', `/parent/kids/${kidId}/messages`, token, { text }),
  sendAudio: (kidId: string, uri: string) => {
    const form = new FormData();
    // React Native's FormData accepts {uri, name, type} for local files.
    form.append('audio', { uri, name: 'message.m4a', type: 'audio/mp4' } as unknown as Blob);
    return request<{ id: string }>('POST', `/parent/kids/${kidId}/messages`, token, form);
  },
  agent: (messages: AgentTurn[]) =>
    request<{ reply: string; actions: AgentAction[] }>('POST', '/parent/agent/chat', token, { messages }),
});

export const kidApi = (token: string) => ({
  config: () => request<KidConfig>('GET', '/kid/me/config', token),
  updateDevice: (pushToken: string | null, installedApps: InstalledApp[] | null) =>
    request<{ ok: true }>('PUT', '/kid/me/device', token, { pushToken, installedApps }),
  book: (bookId: string) => request<BookWithText>('GET', `/kid/books/${bookId}`, token),
  challenge: (bookId: string | null, passage: string) => request<PublicChallenge>('POST', '/kid/challenges', token, { bookId, passage }),
  answer: (challengeId: string, answers: number[]) =>
    request<ChallengeResult>('POST', `/kid/challenges/${challengeId}/answers`, token, { answers }),
  logSession: (s: { bookId?: string; seconds: number; fromPage?: number; toPage?: number; appPackage?: string; challengeId?: string; passed?: boolean }) =>
    request<{ ok: true }>('POST', '/kid/sessions', token, s),
  unplayedMessages: () => request<Message[]>('GET', '/kid/me/messages?unplayed=1', token),
  markPlayed: (id: string) => request<{ ok: boolean }>('POST', `/kid/me/messages/${id}/played`, token),
});
