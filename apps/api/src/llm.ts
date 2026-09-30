import OpenAI from 'openai';

// Nebius Token Factory speaks the OpenAI API, so the official SDK works with a different base URL.
// Docs: https://docs.tokenfactory.nebius.com/api-reference/introduction
export const TOKEN_FACTORY_BASE_URL = process.env.NEBIUS_BASE_URL ?? 'https://api.tokenfactory.nebius.com/v1/';

/** Model for questions and the agent. Must support tool calling. Override with NEBIUS_MODEL. */
export const MODEL = process.env.NEBIUS_MODEL ?? 'meta-llama/Llama-3.3-70B-Instruct';

let client: OpenAI | null = null;

export function llm(): OpenAI {
  if (!process.env.NEBIUS_API_KEY) throw new LlmUnavailableError('NEBIUS_API_KEY is not set');
  client ??= new OpenAI({ apiKey: process.env.NEBIUS_API_KEY, baseURL: TOKEN_FACTORY_BASE_URL });
  return client;
}

export class LlmUnavailableError extends Error {}
