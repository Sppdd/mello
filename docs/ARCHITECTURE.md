# Mello: a parent-controlled reading agent for kids' phones

## Context
The parent wants an AI agent on their kids' phones that follows the parent's orders. The first goals are:
1. **Reading gate.** When a kid opens a blocked app such as social media, they must read a book for N minutes (for example 1 or 5) before the app unlocks.
2. **Reading challenges.** The agent checks that the kid actually read, using quick comprehension questions about the pages they just read.
3. **Voice messages.** The parent can make the agent play an audio message on the kid's phone.
4. **The AI runs on Nebius Token Factory.** Its OpenAI-compatible API handles the LLM work.

Decisions made: Android and iOS, **Android first**. React Native (Expo) with native modules. The parent uses **parent mode in the same app**.

## What v0.1 implements, and where it differs from the original plan
- **Done:** the backend (pairing, rules, books, challenges, sessions, messages, agent), the Android reading gate, the reader with its timer, the quiz, parent mode, and the agent chat. The iOS module is a stub that reports "not supported".
- **npm workspaces** instead of pnpm, because pnpm/corepack was broken on the dev machine.
- **SQLite** (built into Node 24) instead of Postgres, so there's nothing to set up locally. The schema is plain SQL, ready to move to Postgres.
- **Expo Push** instead of calling FCM/APNs directly. Expo forwards to both, so no Firebase or Apple keys are needed on the server.
- **Voice messages** are the parent's own recordings, or typed text that the kid's phone reads aloud with on-device text-to-speech (`expo-speech`). Token Factory has no `/v1/audio/*` endpoints, so no TTS model is used there.
- **Quizzes are multiple choice.** The LLM writes the questions, and the server grades them against answers it stores. That's deterministic, cheap, and works for young kids.
- **API routes** are split into public (`/families`, `/pair`, `/audio/:file`), `/parent/*` (parent token), and `/kid/*` (device token).

## Platform reality (this shapes the design)
| | Android | iOS |
|---|---|---|
| Detect a blocked app being opened | `AccessibilityService` (foreground app events) plus `UsageStatsManager` as a fallback | Screen Time: `FamilyControls` + `ManagedSettings` shields |
| Show the challenge | A full-screen Mello activity launches on top of the blocked app | The shield screen can only be customized (`ShieldConfiguration` extension). The shield button sends a local notification, and tapping it opens Mello to the challenge |
| Unlock for X minutes | The service keeps a per-app "unlocked until" timestamp | Remove the shield, then re-apply it on a timer with a `DeviceActivity` monitor extension |
| Prevent uninstall | Device Admin (optional later: Device Owner via QR provisioning) | `FamilyControls` `.child` authorization blocks deletion under Family Sharing |
| Approvals needed | Play policy declaration for Accessibility use (sideload during development) | Apple **Family Controls (Distribution) entitlement**. Request it early; approval can take weeks |

## Architecture
```
Parent phone (Mello, parent mode) ──HTTPS──▶ Backend API ◀──HTTPS/WS── Kid phone (Mello, kid mode)
                                               │   ▲                    ├─ Native blocker (Kotlin / Swift ext.)
                                               │   └─ push (FCM/APNs) ──┘  ├─ Reader (EPUB/PDF)
                                               ▼                           └─ Challenge + audio player
                                    Nebius Token Factory (LLM)
                                    Postgres + object storage (books, audio)
```

### 1. Mobile app (`apps/mobile`, Expo bare workflow + TypeScript)
- **Kid mode:** a book reader (EPUB with `@epubjs-react-native` or a similar library; plain text or PDF also work). A reading timer that counts only active reading time: pauses when the app goes to the background, plus a check for no page turns in about 90 seconds. Comprehension quiz, rewards and streaks, and an audio-message player (`expo-av`) that also plays automatically when a push notification arrives.
- **Parent mode:** pairing (QR code or 6-digit code), a rules editor (blocked apps, minutes required, daily limits, quiet hours), a book library, a voice recorder for messages, a chat box ("the agent") for giving orders in plain language, and an activity feed.
- **Native module `mello-blocker`** (`modules/mello-blocker/`) exposes the same JS API on both platforms: `setRules`, `getInstalledApps` / `pickApps`, `unlock(app, minutes)`, and an `onBlockedAppOpened` event.
  - Android (Kotlin): an `AccessibilityService`, a foreground service, a launcher intent that opens the challenge, and a Device Admin receiver.
  - iOS (Swift): a `FamilyActivityPicker` bridge plus 3 app extensions: ShieldConfiguration, ShieldAction, and DeviceActivityMonitor. They share state through an App Group.

### 2. Backend (`apps/api`, TypeScript with Hono or Fastify on Node 24)
- REST API for accounts, families, devices, rules, books, reading sessions, and messages.
- Push delivery through FCM (Android) and APNs (iOS), used for rule updates and new audio messages.
- **Agent service:** an LLM tool-calling loop against Nebius Token Factory (OpenAI-compatible `base_url`, `NEBIUS_API_KEY`), with tools including:
  - `set_reading_rule(kidId, apps[], minutes)`, `assign_book(kidId, bookId)`, `send_voice_message(kidId, text|audioId)`, `get_reading_report(kidId, range)`.
  - The parent types "make Sara read 5 minutes before TikTok"; the agent calls a tool; the backend saves the rule and pushes it to Sara's phone.
- **Challenge generation:** the kid's phone sends the text of the pages just read. The LLM returns 2–3 age-appropriate questions as structured JSON, then grades the kid's answers. Rule of thumb: pass means unlock. Fail means read another minute and try again (never a hard lock-out).
- **Voice messages:** the parent's own recording, or typed text spoken by the kid's phone (on-device TTS). Token Factory has no audio endpoints; if cloud voices are wanted later, use a dedicated TTS provider.
- Storage: SQLite and local disk now. Move to Postgres (Neon or Supabase) and S3-compatible storage for production. Hosting: Vercel Functions or Nebius Compute; either works.

### 3. Kid safety and privacy (Mello handles children's data)
- Page text goes to the LLM, but no personal data about the kid is included. Use first names only.
- Always allow emergency calls and parent-approved apps, and never block the phone app.
- Offline fallback: if the backend or LLM is unreachable, the phone uses a timer-only gate so the kid is never stuck.

## Repo layout (monorepo, npm workspaces)
```
mello/
  apps/mobile/            Expo app (kid + parent modes), routes in src/app
  apps/mobile/modules/mello-blocker/   native Android/iOS blocker
  apps/api/               backend + agent + Token Factory client
  packages/shared/        zod schemas, types (Rule, Session, Challenge)
  docs/ARCHITECTURE.md    this plan
  README.md, .gitignore, .env.example
```

## Build order
1. **Repo setup:** `git init`, add the scaffold, `ARCHITECTURE.md`, `.gitignore`, and `.env.example` (with `NEBIUS_API_KEY`, `DATABASE_URL`, and FCM/APNs keys). Add remote `origin https://github.com/Sppdd/mello.git`, commit, and push `main`.
2. **Backend skeleton:** schema, pairing, rules CRUD, and the Token Factory client with a challenge-generation endpoint.
3. **Android blocker:** AccessibilityService, then the challenge screen, then unlock with a timer.
4. **Reader + timer + quiz** in React Native, connected to the backend.
5. **Parent mode:** pairing, rules, and voice recording, with messages pushed to the kid's phone and played automatically.
6. **Agent chat:** tool-calling loop for plain-language orders.
7. **iOS:** Screen Time extensions (after the entitlement request is approved).

## Verification
- Backend: unit tests for rule evaluation and the challenge JSON schema. An integration test calls Token Factory with a sample passage and checks the result against the schema.
- Android: on an emulator or a real device, open a blocked app. The challenge should appear, and after N minutes of reading and a passing quiz the app should unlock, then re-lock when the timer ends.
- Parent to kid: record a message on the parent device and confirm it plays on the kid device within a few seconds.
- iOS: test on a real device using the development Family Controls entitlement (the simulator can't apply shields).
