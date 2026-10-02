# Self mode ("Just me") and the character cast

Mello started as parent → kid. Self mode is the same engine pointed at your own phone: no one else watches, and a companion character helps you scroll less and read or listen more.

## What it does
- **Companion characters.** Pick one of five and make it yours (nickname, tone, voice). The same cast is the kids' reading buddy.
  | | Species | Personality | Kids |
  |---|---|---|---|
  | Mello | marshmallow | gentle, warm (default) | ✓ |
  | Pip | sparrow | upbeat hype | ✓ |
  | Sage | owl | calm, asks good questions | ✓ |
  | Bruno | bear | tough-love coach | adults/teens |
  | Luna | cat | quiet wind-down, listening | ✓ |
  - Cast, lines and persona prompts: `packages/shared/src/characters.ts`.
  - Drawings: `apps/mobile/src/components/Character.tsx` (SVG, five moods).
  - The app never shows "agent" internals: no tool logs, and changes are told in the character's voice.
- **Focus sessions in other apps.** "20 minutes in ReadEra", optionally required before Instagram opens.
  - While a session runs, leaving the app sends you back. Mello, the phone/emergency apps and Settings always stay reachable.
  - Time only counts while you're active in the app (a scroll, tap or page turn within 90 s).
  - **Break-glass:** hold for 10 s, then type why. The session ends and this is logged honestly.
  - Afterwards the companion asks 1–2 open reflection questions. These are not graded, and you can skip them.
- **Habit insights.** Today vs your 7-day usual per category (social, video, games, reading, listening), your most-opened apps, unlocks and focus minutes.
- **Goals:** daily focus goals, daily limits per app or per category, and wind-down hours. **Interests:** topics the companion suggests books and podcasts from.
- **Streak.** A day counts when the guard (the accessibility service) was on for ≥ 90% of screen-on time *and* one goal was met. One freeze per week bridges a single missed day.
- **Guard-off reminders.** If the guard is switched off, the companion posts a reminder at most 3 times a day (WorkManager, every 15 min). Mello never tries to stop you turning it off; it's your phone.
- **Talk to your companion** (`/self/coach/chat`). It can read your daily totals and set limits, focus goals and wind-down hours. It can remember interests, and it can *offer* a focus session, which only starts when you tap it.

## How it's built
A self user is a row in `kids` with `kind = 'self'`, inside a family the user owns (`003_self.sql`). That means:
- The phone gets a device token and reuses `/kid/*`, `syncKid` and the native gate unchanged. Goals and limits use the existing `/parent/kids/:id/*` routes with the user's Supabase token.
- `/self/*` adds the profile, usage upload, reflections, the coach, history delete and sign-out.
- Parent views, alerts and the parent agent only list `kind = 'kid'`.

The new task kind `'app'` (`appPackage`) is what a focus goal is. A rule with `activity: 'task'` that points at it gives "this app waits until the goal is done".

The native focus lock lives in `MelloAccessibilityService.evaluateFocus()`; its pure-TS mirror is `focusDecision()` in shared, which is what the tests cover.

## Privacy
| Leaves the phone (to our API, then Nebius for chat/reflection) | Never leaves the phone |
|---|---|
| Daily totals: minutes and opens for the top 15 apps, minutes per category, unlocks, guard-on share, focus minutes | Raw usage events and timestamps |
| Goals, limits, interests, companion settings | Screen content (the service can't read it: `canRetrieveWindowContent=false`) |
| Chat messages you send, reflection answers | Notifications, messages, contacts, location |
| Break-glass reason (only stored in your own account) | Coach chat history (kept on the phone) |

Usage totals are kept 30 days. **Sign out → Delete my history** removes usage, sessions, reflections and alerts at once.

To keep model calls in your own infrastructure, point the API at any OpenAI-compatible server (`NEBIUS_BASE_URL`, `NEBIUS_MODEL`, e.g. Ollama or vLLM). The model must support tool calling.

## Known limitations
- Android only, like the gate. iOS needs the Screen Time entitlement.
- Pages read in another app are self-reported; Mello doesn't read the screen.
- The guard-on share is measured against screen-on time from UsageStats (Android 9+). On older phones it falls back to "was the guard on when you opened Mello".
- If you're also a parent, a phone set to "Just me" shows personal mode only. Parent controls stay on your other phones.

## Next
1. Diary with context: a daily entry, with the companion reflecting on that day's usage. An optional, on-device-only "where was I".
2. An Android home-screen streak widget.
3. Model choices on the phone: bring your own provider (OpenAI-compatible or Anthropic), or an on-device model (llama.rn + a small GGUF) for zero server LLM calls.
4. Parents assigning `'app'` focus tasks to kids ("20 min in Audible before TikTok").
5. A separate track, outside Mello: a privacy-first errands agent (shopping, booking). It needs:
   - ephemeral browser sandboxes;
   - an on-device credential vault;
   - single-use virtual cards with caps;
   - confirm-before-pay.

   It would get its own design doc (`docs/ERRANDS_AGENT.md`).
