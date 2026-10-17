import type OpenAI from 'openai';
import { llm, MODEL, TOKEN_FACTORY_BASE_URL } from './llm.ts';
import { generateChallenge } from './challenge.ts';

export type LiveCheck = { name: string; ok: boolean; ms: number; detail: string };
export type LiveTestResult = { model: string; baseUrl: string; ok: boolean; ranAt: string; checks: LiveCheck[] };

const PASSAGE = `The tortoise had walked the same path every morning for forty years. It never hurried. While the hares raced
to the river and back, then lay exhausted in the shade, the tortoise kept its slow, even pace, stopping only to eat the
yellow flowers that grew beside the old stone wall. One spring a young hare asked how it could stand being so slow.
"I am not slow," said the tortoise. "I simply never stop." By summer the hare had started walking with it.`;

async function timed(name: string, fn: () => Promise<string>): Promise<LiveCheck> {
  const t = Date.now();
  try {
    const detail = await fn();
    return { name, ok: true, ms: Date.now() - t, detail };
  } catch (err) {
    return { name, ok: false, ms: Date.now() - t, detail: err instanceof Error ? err.message.slice(0, 300) : String(err) };
  }
}

/**
 * Checks the live AI path end to end against Nebius Token Factory: the key and model, a plain chat
 * completion, a tool call (what Mello's coach relies on) and a reading quiz in strict JSON.
 * Used by `GET /demo/live-test` and `npm run live-test`.
 */
export async function runLiveTest(): Promise<LiveTestResult> {
  const checks: LiveCheck[] = [];
  const done = () => ({ model: MODEL, baseUrl: TOKEN_FACTORY_BASE_URL, ok: checks.every((c) => c.ok), ranAt: new Date().toISOString(), checks });

  let client: OpenAI;
  try {
    client = llm();
  } catch {
    checks.push({ name: 'API key and model', ok: false, ms: 0, detail: 'NEBIUS_API_KEY is not set on the server' });
    return done();
  }

  checks.push(
    await timed('API key and model', async () => {
      const ids: string[] = [];
      for await (const m of client.models.list()) ids.push(m.id);
      if (!ids.includes(MODEL)) {
        const nvidia = ids.filter((id) => id.toLowerCase().includes('nemotron')).slice(0, 8);
        throw new Error(`${MODEL} is not in this account's model list. Nemotron models available: ${nvidia.join(', ') || 'none'}`);
      }
      return `${MODEL} is available (${ids.length} models on the account)`;
    }),
  );
  if (!checks[0]!.ok) return done();

  checks.push(
    await timed('Chat completion', async () => {
      const res = await client.chat.completions.create({
        model: MODEL,
        temperature: 0,
        max_tokens: 300,
        messages: [{ role: 'user', content: 'Reply with one short friendly sentence from a calm tortoise named Mello.' }],
      });
      const text = (res.choices[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (!text) throw new Error('Empty reply');
      return `“${text.slice(0, 120)}”`;
    }),
  );

  checks.push(
    await timed('Tool calling', async () => {
      const res = await client.chat.completions.create({
        model: MODEL,
        temperature: 0,
        messages: [
          { role: 'system', content: 'You help the user manage their phone habits. Use the tools when asked to change something.' },
          { role: 'user', content: 'Please limit TikTok to 20 minutes a day.' },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'set_limit',
              description: 'Set a daily time limit for an app.',
              parameters: {
                type: 'object',
                properties: { app: { type: 'string', description: 'App name' }, minutes_per_day: { type: 'integer' } },
                required: ['app', 'minutes_per_day'],
              },
            },
          },
        ],
      });
      const call = res.choices[0]?.message?.tool_calls?.[0];
      if (!call || call.type !== 'function') throw new Error('The model answered without calling the tool');
      const args = JSON.parse(call.function.arguments || '{}');
      if (call.function.name !== 'set_limit' || Number(args.minutes_per_day) !== 20) throw new Error(`Unexpected call: ${call.function.name}(${call.function.arguments})`);
      return `set_limit(${call.function.arguments})`;
    }),
  );

  checks.push(
    await timed('Reading quiz (strict JSON)', async () => {
      const quiz = await generateChallenge(PASSAGE, 10);
      return `${quiz.questions.length} questions, e.g. “${quiz.questions[0]!.question}”`;
    }),
  );

  return done();
}
