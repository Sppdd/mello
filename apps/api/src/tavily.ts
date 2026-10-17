import OpenAI from 'openai';
import { llm, LlmUnavailableError, MODELS } from './llm.ts';
import { extractJson } from './challenge.ts';

/**
 * Tavily web search (https://docs.tavily.com), called from the API only; the key never reaches a phone.
 * Two uses:
 * - findKidContent: real, current articles / videos / audio a parent can assign as a task. Every hit is
 *   screened by Nemotron Nano for age fit before the parent sees it.
 * - searchParenting: sourced answers to a parent's question (screen time, sleep, reading levels…).
 * Only the search topic and an age leave the server: never names, apps or usage.
 */

export type ContentKind = 'article' | 'video' | 'audio';
export type WebResult = { title: string; url: string; snippet: string };
export type ContentPick = WebResult & { kind: ContentKind; why: string; suggestedMinutes: number };

const TAVILY_URL = 'https://api.tavily.com/search';

// Never shown to a kid, whatever the search returns.
const BLOCKED_HOSTS = ['reddit.com', 'tiktok.com', 'instagram.com', 'facebook.com', 'x.com', 'twitter.com', '4chan.org', 'tumblr.com', 'onlyfans.com', 'discord.com', 'twitch.tv'];
const KID_SITES: Record<ContentKind, string[]> = {
  video: ['youtube.com'],
  article: [],
  audio: [],
};
const KID_HINT: Record<ContentKind, string> = {
  video: 'educational video for kids',
  article: 'article for kids',
  audio: 'podcast episode for kids',
};

export class SearchUnavailableError extends Error {}

export const searchEnabled = () => Boolean(process.env.TAVILY_API_KEY);

async function tavily(body: Record<string, unknown>): Promise<{ answer?: string | null; results: { title: string; url: string; content: string }[] }> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new SearchUnavailableError('Web search is not set up (TAVILY_API_KEY)');
  const res = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new SearchUnavailableError(`Web search failed (${res.status})`);
  return res.json() as any;
}

export function isBlocked(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return url.startsWith('http:') || BLOCKED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return true;
  }
}

const SCREEN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'safe', 'why', 'minutes'],
        properties: {
          index: { type: 'integer' },
          safe: { type: 'boolean' },
          why: { type: 'string' },
          minutes: { type: 'integer', minimum: 3, maximum: 60 },
        },
      },
    },
  },
};

/**
 * Nemotron Nano reads each search hit and keeps only ones that suit the age: no violence, sexual content,
 * gambling, scary or ad-heavy pages, no comment sections or social feeds. Fails closed: no verdict, no result.
 */
export async function screenForKids(results: WebResult[], age: number, topic: string) {
  if (!results.length) return [];
  const res = await llm().chat.completions.create({
    model: MODELS.fast,
    temperature: 0,
    response_format: { type: 'json_schema', json_schema: { name: 'kid_screen', strict: true, schema: SCREEN_SCHEMA } },
    messages: [
      {
        role: 'system',
        content: `You check web results before a parent assigns them to a ${age}-year-old as a learning task about "${topic}".
Mark safe=true only if the page is clearly suitable for that age: educational or wholesome, on topic, no violence, sexual content,
gambling, drugs, horror, hate, dangerous challenges, or social-media feeds and comment threads. When unsure, safe=false.
"why" is one short sentence a parent reads (what the kid will learn). "minutes" is a fair time to spend on it.
Reply as JSON: {"items":[{"index":0,"safe":true,"why":"...","minutes":10}]}`,
      },
      { role: 'user', content: results.map((r, i) => `[${i}] ${r.title}\n${r.url}\n${r.snippet.slice(0, 400)}`).join('\n\n') },
    ],
  });
  const parsed = JSON.parse(extractJson(res.choices[0]?.message?.content ?? '{}')) as { items?: { index: number; safe: boolean; why: string; minutes: number }[] };
  return (parsed.items ?? []).filter((v) => v.safe && results[v.index]).map((v) => ({ ...results[v.index]!, why: v.why, suggestedMinutes: v.minutes }));
}

export async function findKidContent(topic: string, kind: ContentKind, age: number, max = 4): Promise<ContentPick[]> {
  const data = await tavily({
    query: `${topic} ${KID_HINT[kind]} age ${age}`,
    search_depth: 'basic',
    max_results: 10,
    include_domains: KID_SITES[kind].length ? KID_SITES[kind] : undefined,
    exclude_domains: BLOCKED_HOSTS,
  });
  const candidates = data.results
    .filter((r) => !isBlocked(r.url))
    .filter((r) => kind !== 'video' || /youtube\.com\/watch|youtu\.be\//.test(r.url))
    .map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? '' }));
  try {
    return (await screenForKids(candidates, age, topic)).slice(0, max).map((r) => ({ ...r, kind }));
  } catch (err) {
    // No safety verdict means nothing reaches the parent as "kid-safe".
    if (err instanceof LlmUnavailableError || err instanceof OpenAI.APIError || err instanceof SyntaxError) return [];
    throw err;
  }
}

export async function searchParenting(question: string, max = 5) {
  const data = await tavily({
    query: question,
    search_depth: 'advanced',
    max_results: max,
    include_answer: 'basic',
    exclude_domains: BLOCKED_HOSTS,
  });
  return {
    answer: data.answer ?? null,
    sources: data.results.filter((r) => !isBlocked(r.url)).map((r) => ({ title: r.title, url: r.url, snippet: (r.content ?? '').slice(0, 500) })),
  };
}
