import type OpenAI from 'openai';
import { RuleInput } from '@mello/shared';
import { llm, MODEL } from './llm.ts';
import type { Repo } from './repo.ts';
import { sendPush } from './push.ts';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

export type AgentTurn = { role: 'user' | 'assistant'; content: string };
export type AgentAction = { tool: string; ok: boolean; summary: string };

const SYSTEM = `You are Mello, a helper that runs on a parent's children's phones and carries out the parent's instructions.
You can: list the kids, see which apps are on each kid's phone, set reading rules (read N minutes before opening an app),
assign books, send a spoken message to a kid's phone, and report on reading.
Guidelines:
- Match apps by name to the package names from list_apps (e.g. "TikTok" -> com.zhiliaoapp.musically). Never invent package names.
- If a request is ambiguous (which kid? which app?), ask one short question instead of guessing.
- Minutes to read must be 1-120. Default unlock time is 30 minutes unless the parent says otherwise.
- After acting, confirm in one or two plain sentences what changed.
- Messages to kids should be warm and short, and in the parent's voice ("Mom says...") only if the parent asks.`;

const tools: Tool[] = [
  fn('list_kids', 'List the kids paired to this family, with their current book.', {}),
  fn('list_apps', "List the apps installed on a kid's phone.", { kid: str('Kid name') }, ['kid']),
  fn('list_books', "List the family's books.", {}),
  fn('list_rules', 'List the reading rules for a kid.', { kid: str('Kid name') }, ['kid']),
  fn(
    'set_reading_rule',
    'Require the kid to read before opening the given apps.',
    {
      kid: str('Kid name'),
      apps: { type: 'array', items: { type: 'string' }, description: 'Android package names from list_apps' },
      minutes_required: { type: 'integer', description: 'Minutes of reading needed, 1-120' },
      unlock_minutes: { type: 'integer', description: 'How long the app stays unlocked afterwards, default 30' },
    },
    ['kid', 'apps', 'minutes_required'],
  ),
  fn('delete_rule', 'Delete a reading rule by id.', { rule_id: str('Rule id from list_rules') }, ['rule_id']),
  fn('assign_book', 'Set the book a kid should read.', { kid: str('Kid name'), book_id: str('Book id from list_books') }, ['kid', 'book_id']),
  fn('send_voice_message', "Speak a message out loud on the kid's phone.", { kid: str('Kid name'), text: str('What to say') }, ['kid', 'text']),
  fn('get_reading_report', "Summarize a kid's reading.", { kid: str('Kid name'), days: { type: 'integer', description: 'Look-back window, default 7' } }, ['kid']),
];

export async function runAgent(repo: Repo, familyId: string, history: AgentTurn[]) {
  const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM }, ...history.slice(-20)];
  const actions: AgentAction[] = [];

  for (let step = 0; step < 8; step++) {
    const res = await llm().chat.completions.create({ model: MODEL, temperature: 0.2, messages, tools });
    const msg = res.choices[0]?.message;
    if (!msg) break;
    messages.push(msg);
    if (!msg.tool_calls?.length) return { reply: msg.content ?? '', actions };

    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue;
      let output: unknown;
      try {
        output = await executeTool(repo, familyId, call.function.name, JSON.parse(call.function.arguments || '{}'), actions);
      } catch (err) {
        output = { error: err instanceof Error ? err.message : String(err) };
        actions.push({ tool: call.function.name, ok: false, summary: String((output as any).error) });
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
    }
  }
  return { reply: 'Sorry, I could not finish that. Please try rephrasing.', actions };
}

export async function executeTool(repo: Repo, familyId: string, name: string, args: any, actions: AgentAction[]): Promise<unknown> {
  const kidOf = (kidName: string) => {
    const kid = repo.findKidByName(familyId, String(kidName ?? ''));
    if (!kid) throw new Error(`No kid named "${kidName}". Known: ${repo.listKids(familyId).map((k) => k.name).join(', ') || 'none'}`);
    return kid;
  };

  switch (name) {
    case 'list_kids':
      return repo.listKids(familyId).map((k) => ({ name: k.name, currentBookId: k.currentBookId, appsKnown: k.installedApps.length }));
    case 'list_apps':
      return kidOf(args.kid).installedApps;
    case 'list_books':
      return repo.listBooks(familyId);
    case 'list_rules':
      return repo.listRules(kidOf(args.kid).id);
    case 'set_reading_rule': {
      const kid = kidOf(args.kid);
      const known = new Set(kid.installedApps.map((a) => a.packageName));
      const unknown = (args.apps as string[]).filter((p) => !known.has(p));
      if (known.size > 0 && unknown.length) throw new Error(`Not installed on ${kid.name}'s phone: ${unknown.join(', ')}`);
      const input = RuleInput.parse({ apps: args.apps, minutesRequired: args.minutes_required, unlockMinutes: args.unlock_minutes ?? undefined });
      const rule = repo.addRule(kid.id, input);
      await sendPush(repo.pushToken(kid.id), 'rules-changed');
      actions.push({ tool: name, ok: true, summary: `${kid.name}: read ${rule.minutesRequired} min before ${rule.apps.join(', ')}` });
      return rule;
    }
    case 'delete_rule': {
      const ok = repo.deleteRule(familyId, args.rule_id);
      actions.push({ tool: name, ok, summary: ok ? 'Rule deleted' : 'Rule not found' });
      return { deleted: ok };
    }
    case 'assign_book': {
      const kid = kidOf(args.kid);
      if (!repo.setCurrentBook(familyId, kid.id, args.book_id)) throw new Error('Book not found');
      await sendPush(repo.pushToken(kid.id), 'book-assigned', { title: 'New book!', body: 'You have a new book to read in Mello.' });
      actions.push({ tool: name, ok: true, summary: `${kid.name} is now reading ${repo.getBook(familyId, args.book_id)?.title}` });
      return { ok: true };
    }
    case 'send_voice_message': {
      const kid = kidOf(args.kid);
      const text = String(args.text ?? '').slice(0, 500);
      if (!text) throw new Error('Message text is empty');
      repo.addMessage(kid.id, 'tts', text, null);
      await sendPush(repo.pushToken(kid.id), 'new-message', { title: 'Message from home', body: 'Tap to listen' });
      actions.push({ tool: name, ok: true, summary: `Message sent to ${kid.name}` });
      return { sent: true };
    }
    case 'get_reading_report':
      return repo.report(kidOf(args.kid).id, args.days ?? 7);
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

function fn(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): Tool {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}
function str(description: string) {
  return { type: 'string', description };
}
