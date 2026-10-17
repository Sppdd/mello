# Mello: hackathon pitch kit

**Event:** Nebius × NVIDIA Global AI Hackathon (Devpost). **Track:** pick one before submitting. [SUBMISSION.md](../SUBMISSION.md) enters **Best Apps and Agents** (the parent agent); this kit was written for **Personal AI** (Mello coaching your own phone). The demo and live test fit both.
**One line:** Mello is a calm tortoise companion on your phone that turns "open Instagram" into "ten minutes of reading first".
**Built on:** NVIDIA Nemotron 3 on Nebius Token Factory: Nano (fast), Super (agent and quiz), Ultra (weekly insight).

> Check the official Devpost rules before submitting. The summary below comes from public listings: they ask for a project that runs on Nebius Token Factory or AI Cloud and uses at least one NVIDIA open model, a working demo URL, and a public repo with an open-source licence and a README. Judging weighs technological implementation, design, potential impact and quality of the idea equally.

---

## 1. Devpost write-up (paste and edit)

### Inspiration
Most of us open social apps on autopilot, and the tools that try to help either nag or lock you out, so people switch them off. We wanted a companion that redirects the habit instead of punishing it, and stays private, because what you do on your phone is nobody else's business.

### What it does
- **Gate:** when you open an app you chose, like Instagram, Mello asks for a small step first, like 10 minutes in your reading app.
- **Proof:** when the time is up, Mello writes three questions about what you just read. Pass, and the app opens for 30 minutes. Miss, and you read one more minute.
- **Companion:** you can talk to Mello in plain language: "limit TikTok to 20 minutes", "how was my week?", "I love stoicism, what should I read?". Mello sees only daily totals (minutes per app), never your screen.
- **Streak:** a gentle streak counts days when your guard was on and you met a goal, with one freeze a week.
- **Families:** a parent mode applies the same gate to kids' phones, with an agent the parent can talk to.

### How we built it
- **AI:** NVIDIA **Nemotron 3** on **Nebius Token Factory**, through its OpenAI-compatible API. Each job uses the size that fits it: Nano for fast calls, Super for tool calling and quizzes, Ultra for the weekly insight. Three jobs matter most here:
  1. **Tool calling:** Mello's coach is a tool-calling loop over the user's own goals, limits, wind-down hours and interests. It runs on the same backend as the parent agent.
  2. **Structured output:** reading quizzes use a strict JSON schema. The server keeps the answers and grades them itself, so the phone never sees them.
  3. **Short, in-character writing:** reflection questions and replies come from one persona prompt, with tone set by the user.
- **Phone:** an Expo / React Native app with an Android AccessibilityService that sees only package names; screen content is never readable.
  - It enforces gates, limits, bedtime and "stay in ReadEra for 10 minutes" focus sessions.
  - UsageStats daily totals feed the coach.
- **Backend:** a Hono API on Node, with Postgres on Supabase (PGlite locally) and Zod schemas shared with the app.
- **Live demo:** `/demo` runs the same API with a sandbox phone in the browser, so anyone can try it without installing anything.

### Challenges
- **Keeping the user in a reading app without reading the screen.** We count only time with real activity (scrolls, taps, page turns) and never inspect content.
- **Making the AI reliable enough to gate an app.** We use strict JSON schemas with retries. If the model is unreachable, reading time alone unlocks the app, so nobody gets stuck.
- **Tool calling that's safe.** Tools only touch the user's own sandboxed data, they validate app names against what's installed, and actions that start sessions are *offered*, never forced.

### Accomplishments
- One character, Mello, across parent, kid and personal modes.
- A design that follows one rule: one main action per screen.
- An end-to-end live test of the AI path: model, chat, tool call and quiz.

### What's next
- Rendered and animated Mello art (Rive).
- Home-screen widgets.
- iOS via Screen Time.
- On-device or bring-your-own model options for people who want zero cloud calls.

---

## 2. Three-minute live demo script
Open `https://<host>/demo` in a desktop browser and turn sound on. Times are cumulative.

| Time | Do | Say |
|---|---|---|
| 0:00 | Page loads; Mello is on screen. | "This is Mello. It lives on your phone and helps you scroll less and read more. Everything AI you'll see runs on NVIDIA Nemotron on Nebius Token Factory." |
| 0:15 | On the phone, tap **Instagram**. | "Like most of us, Sam opens Instagram on autopilot. Mello steps in and asks for ten minutes of reading first." |
| 0:30 | **Start reading**; tick **×20**. | "Sam reads in their own reading app. Time only counts while they're actually reading." |
| 0:55 | **Quiz me**. | "Now Nemotron writes three questions about exactly what Sam just read. The answers stay on the server." |
| 1:15 | Answer, then **Check**. | "Sam passes, so today's goal is done and Instagram opens for 30 minutes, with Mello in a small bubble." |
| 1:30 | Chat chip **"Limit TikTok to 20 minutes a day"**; tick **Show what Nemotron did**. | "Sam can just talk to Mello. Nemotron decides to call our `set_limit` tool…" |
| 1:50 | On the phone, Home → **TikTok**. | "…and the phone changes immediately: TikTok now shows twenty minutes left." |
| 2:05 | Chip **"How was Sam's week?"**. | "Mello sees only daily totals, not messages or screens, and turns them into one honest, kind sentence." |
| 2:25 | **Run live test**. | "Under the hood: the key and model, a chat, a tool call and a strict-JSON quiz, live against Token Factory, with latency." |
| 2:45 | Back to Mello. | "Small steps, big journeys. Mello is private, gentle, and built on open models. Thank you." |

**Backup plan:** if the network fails, the phone still unlocks on reading time alone, as the real app does. Keep a screen recording of a clean run ready.

---

## 3. Two-minute video shot list
1. **Hook (0:00–0:10).** A thumb opens Instagram, and the phone flips to Mello: "Ten minutes of reading first?"
2. **Problem (0:10–0:25).** Voice-over: autopilot scrolling, and why lock-out apps get switched off.
3. **Flow (0:25–1:05).** Screen capture of `/demo`: gate → reading (×20) → Nemotron quiz → unlock and bubble.
4. **Companion (1:05–1:30).** The chat sets the TikTok limit, the tool call is visible, and the phone updates.
5. **Privacy (1:30–1:42).** A card: "Mello sees daily totals. Never your screen."
6. **Tech (1:42–1:55).** The live test panel, plus a diagram: phone → API → Nemotron on Nebius Token Factory.
7. **Close (1:55–2:00).** Mello breathing, blinking. "Small steps, big journeys."

---

## 4. Judging criteria → where we show it

| Criterion | What judges see |
|---|---|
| **Technological implementation** | Nemotron tool-calling agent over real data. Strict-JSON quizzes graded on the server. A native Android gate that never reads the screen. A live test of the AI path. Tests in CI. |
| **Design** | One main action per screen; Mello as a live character; gentle and honest copy; works at phone width. |
| **Potential impact** | Works for adults (Personal AI) and families. It replaces lock-outs with small positive steps and keeps the user's trust through privacy. |
| **Quality of the idea** | It turns the moment of temptation into the moment of a good habit, with proof (the quiz) instead of a timer. |

---

## 5. Submission checklist
- [ ] `npm run live-test -w @mello/api` passes against **your** Token Factory account. If check 1 fails, set `NEBIUS_MODEL_FAST` / `_AGENT` / `_REASONING` to the Nemotron IDs it lists.
- [ ] `DEMO=1` is set on the hosted API (Cloud Run, see `docs/DEPLOY.md`), `/demo` loads, and **Run live test** is green.
- [ ] The README has the demo URL instead of `<your demo URL>`.
- [ ] The repository is **public**, with `LICENSE` (MIT) and the README.
- [ ] The video is uploaded (if Devpost asks for one), and the track on Devpost matches SUBMISSION.md and this kit.
- [ ] Team members are added on Devpost; the deadline (30 Oct 2026, 10:00 PT per listings) is double-checked on the official page.
