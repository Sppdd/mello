import type OpenAI from 'openai';
import { RuleInput, TaskInput } from '@mello/shared';
import { llm, MODEL } from './llm.ts';
import type { Repo } from './repo.ts';
import { sendPush } from './push.ts';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

export type AgentTurn = { role: 'user' | 'assistant'; content: string };
export type AgentAction = { tool: string; ok: boolean; summary: string };

const SYSTEM = `You are Mello, a helper that runs on a parent's children's phones and carries out the parent's instructions.
You can: list the kids, see which apps are on each kid's phone, set reading rules (read N minutes before opening an app),
assign books, create tasks (listen to audio, watch a YouTube video, read an article, or read a book for N minutes) and
optionally require a task before apps open, set daily time limits per app, set bedtime hours, send a spoken message
to a kid's phone, check alerts (e.g. the gate was switched off), and report on reading and tasks.
Guidelines:
- Match apps by name to the package names from list_apps (e.g. "TikTok" -> com.zhiliaoapp.musically). Never invent package names.
- If a request is ambiguous (which kid? which app?), ask one short question instead of guessing.
- Minutes to read must be 1-120. Default unlock time is 30 minutes unless the parent says otherwise.
- Video tasks need a YouTube link; audio and article tasks need an https link. Ask for the link if it's missing.
- Bedtime times are the kid's local time, given as HH:MM (24h).
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
  fn(
    'create_task',
    'Assign an activity. Optionally make it required before some apps open.',
    {
      kid: str('Kid name'),
      kind: { type: 'string', enum: ['audio', 'video', 'article', 'reading'] },
      title: str('Short title the kid sees'),
      url: str('YouTube link (video), https audio file or page (audio/article). Omit for reading.'),
      minutes: { type: 'integer', description: 'Minutes of real listening/watching/reading, 1-180' },
      repeat: { type: 'string', enum: ['daily', 'once'], description: 'Default daily' },
      required_before_apps: { type: 'array', items: { type: 'string' }, description: 'Package names that stay locked until the task is done today' },
    },
    ['kid', 'kind', 'title', 'minutes'],
  ),
  fn('list_tasks', "List a kid's tasks.", { kid: str('Kid name') }, ['kid']),
  fn(
    'set_app_limit',
    'Set a daily time limit for an app (0 blocks it for the day).',
    { kid: str('Kid name'), app: str('Package name from list_apps'), minutes_per_day: { type: 'integer' } },
    ['kid', 'app', 'minutes_per_day'],
  ),
  fn(
    'set_bedtime',
    'Block all apps except allowed ones between start and end.',
    {
      kid: str('Kid name'),
      start: str('HH:MM, e.g. 21:00'),
      end: str('HH:MM, e.g. 07:00'),
      allowed_apps: { type: 'array', items: { type: 'string' }, description: 'Package names still allowed at bedtime' },
      enabled: { type: 'boolean', description: 'false turns bedtime off' },
    },
    ['kid', 'start', 'end'],
  ),
  fn('get_alerts', 'Recent alerts, e.g. a kid switched off the reading gate.', {}),
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
  const kidOf = async (kidName: string) => {
    const kid = await repo.findKidByName(familyId, String(kidName ?? ''));
    if (!kid) {
      const known = (await repo.listKids(familyId)).map((k) => k.name).join(', ') || 'none';
      throw new Error(`No kid named "${kidName}". Known: ${known}`);
    }
    return kid;
  };
  const checkApps = (kid: { name: string; installedApps: { packageName: string }[] }, apps: string[]) => {
    const known = new Set(kid.installedApps.map((a) => a.packageName));
    const unknown = apps.filter((p) => !known.has(p));
    if (known.size > 0 && unknown.length) throw new Error(`Not installed on ${kid.name}'s phone: ${unknown.join(', ')}`);
  };
  const hhmm = (v: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim());
    if (!m || +m[1]! > 23 || +m[2]! > 59) throw new Error(`Time must be HH:MM, got "${v}"`);
    return +m[1]! * 60 + +m[2]!;
  };

  switch (name) {
    case 'list_kids':
      return (await repo.listKids(familyId)).map((k) => ({ name: k.name, currentBookId: k.currentBookId, appsKnown: k.installedApps.length, lastSeenAt: k.lastSeenAt }));
    case 'list_apps':
      return (await kidOf(args.kid)).installedApps;
    case 'list_books':
      return repo.listBooks(familyId);
    case 'list_rules':
      return repo.listRules((await kidOf(args.kid)).id);
    case 'set_reading_rule': {
      const kid = await kidOf(args.kid);
      checkApps(kid, args.apps ?? []);
      const input = RuleInput.parse({ apps: args.apps, minutesRequired: args.minutes_required, unlockMinutes: args.unlock_minutes ?? undefined });
      const rule = await repo.addRule(kid.id, input);
      await sendPush(await repo.pushToken(kid.id), 'rules-changed');
      actions.push({ tool: name, ok: true, summary: `${kid.name}: read ${rule.minutesRequired} min before ${rule.apps.join(', ')}` });
      return rule;
    }
    case 'delete_rule': {
      const ok = await repo.deleteRule(familyId, args.rule_id);
      actions.push({ tool: name, ok, summary: ok ? 'Rule deleted' : 'Rule not found' });
      return { deleted: ok };
    }
    case 'assign_book': {
      const kid = await kidOf(args.kid);
      if (!(await repo.setCurrentBook(familyId, kid.id, args.book_id))) throw new Error('Book not found');
      await sendPush(await repo.pushToken(kid.id), 'book-assigned', { title: 'New book!', body: 'You have a new book to read in Mello.' });
      actions.push({ tool: name, ok: true, summary: `${kid.name} is now reading ${(await repo.getBook(familyId, args.book_id))?.title}` });
      return { ok: true };
    }
    case 'create_task': {
      const kid = await kidOf(args.kid);
      const input = TaskInput.parse({ kind: args.kind, title: args.title, url: args.url || null, requiredMinutes: args.minutes, repeat: args.repeat ?? 'daily' });
      const task = await repo.addTask(familyId, kid.id, input);
      const apps: string[] = args.required_before_apps ?? [];
      if (apps.length) {
        checkApps(kid, apps);
        await repo.addRule(kid.id, RuleInput.parse({ apps, activity: 'task', taskId: task.id, minutesRequired: Math.min(task.requiredMinutes, 120) }));
      }
      await sendPush(await repo.pushToken(kid.id), 'rules-changed', { title: 'New task', body: task.title });
      actions.push({ tool: name, ok: true, summary: `${kid.name}: ${task.kind} task "${task.title}" (${task.requiredMinutes} min)${apps.length ? ` before ${apps.join(', ')}` : ''}` });
      return task;
    }
    case 'list_tasks':
      return repo.listTasks((await kidOf(args.kid)).id);
    case 'set_app_limit': {
      const kid = await kidOf(args.kid);
      checkApps(kid, [args.app]);
      const minutes = Math.max(0, Math.min(1440, Math.round(Number(args.minutes_per_day))));
      await repo.setLimit(kid.id, { packageName: args.app, dailyMinutes: minutes });
      await sendPush(await repo.pushToken(kid.id), 'rules-changed');
      actions.push({ tool: name, ok: true, summary: `${kid.name}: ${args.app} limited to ${minutes} min/day` });
      return { ok: true };
    }
    case 'set_bedtime': {
      const kid = await kidOf(args.kid);
      const allowed: string[] = args.allowed_apps ?? [];
      checkApps(kid, allowed);
      await repo.setQuietHours(kid.id, { enabled: args.enabled ?? true, startMinute: hhmm(args.start), endMinute: hhmm(args.end), allowedApps: allowed });
      await sendPush(await repo.pushToken(kid.id), 'rules-changed');
      actions.push({ tool: name, ok: true, summary: args.enabled === false ? `${kid.name}: bedtime off` : `${kid.name}: bedtime ${args.start}–${args.end}` });
      return { ok: true };
    }
    case 'get_alerts':
      return repo.listAlerts(familyId, false);
    case 'send_voice_message': {
      const kid = await kidOf(args.kid);
      const text = String(args.text ?? '').slice(0, 500);
      if (!text) throw new Error('Message text is empty');
      await repo.addMessage(kid.id, 'tts', text, null);
      await sendPush(await repo.pushToken(kid.id), 'new-message', { title: 'Message from home', body: 'Tap to listen' });
      actions.push({ tool: name, ok: true, summary: `Message sent to ${kid.name}` });
      return { sent: true };
    }
    case 'get_reading_report':
      return repo.report((await kidOf(args.kid)).id, args.days ?? 7);
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
