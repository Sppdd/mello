# Mello: Devpost submission

Paste-ready text for the Nebius x NVIDIA Global AI Hackathon form. **Track: Best Apps and Agents.**

---

## Tagline
A private AI helper on your kid's phone: they read or learn before TikTok opens, and you manage it all by chatting. Runs on NVIDIA Nemotron via Nebius Token Factory.

## Inspiration
Every parent we talked to had the same evening argument: "five more minutes" of TikTok. The tools they had were on/off switches and charts nobody reads. They block apps, but they can't turn screen time into something worthwhile, and they can't tell whether a kid really read the page or just left it open. Parents also told us they didn't want a "smart" parental app that sends their child's behaviour to a big consumer AI company.

So we built Mello: a calm tortoise that lives on the kid's phone, follows the parent's instructions, and runs on private inference.

## The problem
1. **Kids get endless algorithmic feeds; parents get a switch.** Blocking stops scrolling but doesn't put anything better in its place.
2. **Parents don't have time.** Rules buried in settings menus don't get set. Weekly usage charts don't get read.
3. **Families don't trust AI with kids' data.** Most "AI" parenting features send a child's activity to a consumer model provider.

## What it does
- **Reading gate.** The parent picks apps (TikTok, YouTube, Instagram…). When the kid opens one, Mello appears: read for N minutes, then pass a 3-question quiz that **NVIDIA Nemotron Super** writes from the *exact pages the kid just read*. Pass, and the app unlocks.
- **Tasks that only count when they really happen.** Assign a YouTube video, a podcast, an article, your own voice recording, or time in a reading app. Timers only run while the media plays or the page is on screen and the phone is held.
- **Find something to learn.** The parent types a topic. Mello searches the live web with **Tavily**, then **Nemotron Nano** checks each result for the kid's age. Only results that pass reach the parent, each with a one-line reason and a suggested time. One tap turns a result into a task.
- **A parent agent you just talk to.** "Make Sara read 10 minutes before YouTube." "Limit Roblox to 45 minutes." "Find her a video about volcanoes and make it a task before TikTok." "How much screen time is right for an 8-year-old?" It is a tool-calling agent on **Nemotron Super** with about 20 tools (rules, tasks, limits, bedtime, spoken messages, reports, Tavily search), and it cites sources for web answers.
- **Weekly insight.** **Nemotron Ultra** reasons over a week of reading minutes, quiz results, task completion, limits and alerts. It writes a headline, wins, things to watch, and next steps. Tapping a step sends it to the agent, which does it.
- **Daily limits, bedtime, and a "time left" bubble** over the kid's apps. Calls and emergency apps can never be blocked.
- **Messages from home**, spoken on the kid's phone in Mello's voice or in the parent's own recording.
- **Hard to switch off.** If the gate, overlay or usage access is turned off, the parent gets an alert. Signing the kid's phone out needs the parent's password or approval.
- **"Just me" mode.** The same coach for adults: focus sessions in reading or podcast apps, reflections and streaks.

## How we built it
- **Mobile:** Expo (React Native, expo-router) and TypeScript. A custom native Android module (`modules/mello-blocker`, Kotlin) provides an AccessibilityService gate, a focus lock, UsageStats limits and an overlay bubble. Mello is drawn live in SVG with Reanimated (breathing, blinking, talking while it speaks); the app icon is our own Blender render.
- **API:** Hono on Node 24 with zod validation everywhere and shared types/gate logic in `packages/shared`. It runs in Docker on Google Cloud Run, with Supabase Postgres + Auth and row-level security.
- **AI:** NVIDIA Nemotron 3 through the **Nebius Token Factory** OpenAI-compatible API, three sizes for three jobs:

| Model | Job |
|---|---|
| `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | Fast, cheap calls: kid-safety screening of every search result (strict JSON schema, fails closed), reflection questions and replies |
| `nvidia/nemotron-3-super-120b-a12b` | Tool-calling agent loops (parent agent, self coach) and reading-quiz generation with structured output |
| `nvidia/Nemotron-3-Ultra-550b-a55b` | Weekly insight: heavier reasoning over a week of data, returning structured findings plus agent-ready next steps |

- **Tavily:** called only from the server. Only the topic or question and an age are sent; never names, apps or usage. Results are domain-filtered (no social feeds or forums, https only), then age-screened by Nemotron before a parent sees them.

## Where Nebius Token Factory helped
- **Drop-in compatibility:** the official `openai` SDK worked by changing only the base URL, so the agent, quiz and coach shared one client from day one.
- **Tool calling and `json_schema` structured output on every Nemotron size.** Switching from a single general model to a Nano/Super/Ultra setup was a one-file change (`apps/api/src/llm.ts`). Strict schemas removed a class of quiz bugs that JSON mode allowed (five choices, a missing answer index).
- **Right-sizing:** the high-volume safety screen runs on Nano. The multi-step agent runs on Super, at about 4–5 s for a two-tool request. Ultra runs only when a parent asks for an insight. The app stays responsive and credits go further.
- **Private by default for families:** with Zero Data Retention turned on, prompts and outputs aren't stored or used for training.

## Privacy
- Mello never sees screen content. The models get minutes, counts, app names, a kid's first name, and (for quizzes) the text of the pages the kid read.
- Inference runs on Nebius Token Factory with Zero Data Retention; there are no consumer chatbot APIs.
- Each family's data lives in its own rows in Postgres, protected by row-level security. Self-mode users can delete their history in the app.
- Enforcement runs on the phone, so rules still work offline.

## Challenges we ran into
- **Proving a kid actually read or watched:** we combined active-screen and motion attention checks, media-playing checks, and quizzes generated only from the pages read.
- **Making the gate hard to bypass without bricking the phone:** Settings and the dialer stay reachable, and switching protection off alerts the parent.
- **Keeping web search safe for kids:** the screen fails closed, and results go only to the parent, never straight to the kid.

## Accomplishments we're proud of
- A real, working gate on a real Android phone. It isn't a mock-up.
- One agent that can set rules, assign web-found content and explain a kid's week, all on open NVIDIA models.
- A character kids like: Mello the tortoise, in five colour skins.

## What we learned
Smaller open models are enough for most calls when the job is narrow and the output is schema-constrained. Save the big reasoning model for the one place it matters.

## What's next
Supabase Storage for voice messages, home-screen widgets, an iOS version (Family Controls), and running the API on Nebius Serverless Endpoints.

## Built with
TypeScript, React Native, Expo, Kotlin (Android AccessibilityService), Hono, Node.js, Zod, Supabase (Postgres, Auth, RLS), Docker, Google Cloud Run, **Nebius Token Factory**, **NVIDIA Nemotron 3 (Nano, Super, Ultra)**, **Tavily**, Blender.

## Was this project updated during the Submission Period?
All of it was built during the Submission Period (started Aug 26, 2026). The first commit is `68c6827` on Sep 30, 2026 ("Mello v0.1: reading gate, quizzes, voice messages and parent agent"). See `git log` for the full history: parent auth on Supabase, tasks with verified timers, daily limits and bedtime, self mode, Mello the tortoise, and finally Nemotron Nano/Super/Ultra, Tavily content ideas and the weekly insight.

---

## Testing instructions

**Test build (Android 8+):** https://github.com/Sppdd/mello/releases/latest (download `mello.apk`). It's free and needs no store account. Allow "install unknown apps" for your browser when asked.

**Hosted API:** https://mello-api-69541089425.asia-northeast1.run.app/health (shows the live Nemotron model map)

**Demo parent account:** email `judge@mello.test`, password `MelloDemo-2026`

### Parent flow (one phone is enough)
1. Open Mello → **I'm the parent** → sign in with the demo account → **Create family** (any name). Note the 6-digit code.
2. Tap **Ask Mello (agent)** and try:
   - "How much screen time is right for an 8-year-old?" (live Tavily search with cited sources)
   - "What can you do?"
3. To see the kid features, pair a second Android phone or emulator (below). Then open the kid on the parent phone:
   - **Get weekly insight** (Nemotron Ultra)
   - **Find something to learn** → "volcanoes" → **Assign** (Tavily, with the Nemotron Nano age check)
   - Add a reading rule for YouTube, a daily limit, or bedtime

### Kid flow (a second phone or emulator)
1. Install the same APK → **This is my kid's phone** → enter the 6-digit code and a name.
2. On the kid home screen, tap **Open settings** for the Mello reading gate (Accessibility) and for usage access, and turn both on.
3. Open the app you added a rule for (e.g. YouTube). Mello opens instead: read or do the task, take the Nemotron-written quiz, and the app unlocks.
4. To sign the kid phone out, use the parent's sign-out password (set it on the parent home screen) or approve the request from the parent phone.

### "Just me" mode
**Coach my own phone** → sign in → follow onboarding. Then tap **Talk to Mello**.

The project stays free and available for testing until the end of judging (Dec 15, 2026).

---

## Feedback on Nebius Token Factory, AI Cloud and NVIDIA models
**What worked well**
- The OpenAI-compatible API made it a drop-in replacement, with no custom SDK.
- Nemotron 3 Super's tool calling was reliable across multi-tool turns. For example, a reading rule and an app limit set from one sentence picked the right package names from tool output.
- Strict `json_schema` output worked the same on Nano, Super and Ultra, which made right-sizing per task painless.
- Ultra's weekly insights were specific and used the real numbers, even on sparse data.

**What could be better**
- **AI Cloud onboarding:** our account could use Token Factory, but creating a container registry or a Serverless Endpoint returned `PermissionDenied` in every project, even for a tenant admin. There was no hint about billing or activation. A clear "activate AI Cloud / apply credits" message would have let us host on Nebius as planned.
- **Model discovery:** a filter by capability (tool calling, structured output, context length) in `/v1/models` would help pick models without trial calls.
- **Reasoning output:** Nemotron returns `reasoning` / `reasoning_content` fields. Documenting how these interact with tool-call loops (whether to send them back) would save guesswork.
- **Zero Data Retention:** making ZDR visible in the API key UI, and reporting it in a response header, would make privacy promises easy to verify.
