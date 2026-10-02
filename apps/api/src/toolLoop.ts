import type OpenAI from 'openai';
import { llm, MODEL } from './llm.ts';

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type Tool = OpenAI.Chat.Completions.ChatCompletionTool;
export type AgentTurn = { role: 'user' | 'assistant'; content: string };
export type AgentAction = { tool: string; ok: boolean; summary: string };
export type ExecuteTool = (name: string, args: any, actions: AgentAction[]) => Promise<unknown>;

/**
 * The tool-calling loop both agents share: ask the model, run the tools it calls, feed the results
 * back, until it answers in plain text (or gives up after 8 rounds).
 */
export async function runToolLoop(system: string, tools: Tool[], execute: ExecuteTool, history: AgentTurn[], opts: { temperature?: number } = {}) {
  const messages: ChatMessage[] = [{ role: 'system', content: system }, ...history.slice(-20)];
  const actions: AgentAction[] = [];

  for (let step = 0; step < 8; step++) {
    const res = await llm().chat.completions.create({ model: MODEL, temperature: opts.temperature ?? 0.2, messages, tools });
    const msg = res.choices[0]?.message;
    if (!msg) break;
    messages.push(msg);
    if (!msg.tool_calls?.length) return { reply: msg.content ?? '', actions, finished: true };

    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue;
      let output: unknown;
      try {
        output = await execute(call.function.name, JSON.parse(call.function.arguments || '{}'), actions);
      } catch (err) {
        output = { error: err instanceof Error ? err.message : String(err) };
        actions.push({ tool: call.function.name, ok: false, summary: String((output as any).error) });
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
    }
  }
  return { reply: '', actions, finished: false };
}

export function fn(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): Tool {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}
export function str(description: string) {
  return { type: 'string', description };
}
