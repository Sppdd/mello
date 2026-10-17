import OpenAI from 'openai';

// Nebius Token Factory speaks the OpenAI API, so the official SDK works with a different base URL.
// Docs: https://docs.tokenfactory.nebius.com/api-reference/introduction
export const TOKEN_FACTORY_BASE_URL = process.env.NEBIUS_BASE_URL ?? 'https://api.tokenfactory.nebius.com/v1/';

/**
 * NVIDIA Nemotron 3 models on Token Factory, one per kind of work:
 * - fast: small, cheap calls on the hot path (reflection questions, kid-safety checks on search results).
 * - agent: tool-calling loops (parent agent, self-mode coach) and the reading quiz.
 * - reasoning: heavier thinking over a week of data (the parent's weekly insight).
 * NEBIUS_MODEL overrides all three, e.g. for a self-hosted OpenAI-compatible server.
 */
export const MODELS = {
  fast: process.env.NEBIUS_MODEL_FAST ?? process.env.NEBIUS_MODEL ?? 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
  agent: process.env.NEBIUS_MODEL_AGENT ?? process.env.NEBIUS_MODEL ?? 'nvidia/nemotron-3-super-120b-a12b',
  reasoning: process.env.NEBIUS_MODEL_REASONING ?? process.env.NEBIUS_MODEL ?? 'nvidia/Nemotron-3-Ultra-550b-a55b',
} as const;

let client: OpenAI | null = null;

export function llm(): OpenAI {
  if (!process.env.NEBIUS_API_KEY) throw new LlmUnavailableError('NEBIUS_API_KEY is not set');
  client ??= new OpenAI({ apiKey: process.env.NEBIUS_API_KEY, baseURL: TOKEN_FACTORY_BASE_URL, timeout: 90_000 });
  return client;
}

export class LlmUnavailableError extends Error {}

/** Nemotron can think out loud; drop any <think> block that leaks into the answer. */
export function stripThinking(text: string | null | undefined): string {
  return (text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
