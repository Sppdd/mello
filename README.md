# Mello

An AI reading buddy that lives on your kids' phones and follows your instructions.

- **Reading gate.** Pick apps (TikTok, Instagram, YouTube…). When your kid opens one, Mello asks them to read for a few minutes first.
- **Proof of reading.** After the timer, Mello asks 2–3 quick questions about the pages they just read. Pass, and the app opens. Miss, and they read one more minute and try again.
- **Messages from home.** Type a message that Mello reads aloud on their phone, or record your own voice.
- **Talk to the agent.** "Make Sara read 5 minutes before TikTok" or "How much did Adam read this week?" The agent runs on [Nebius Token Factory](https://tokenfactory.nebius.com).

Android first. On iPhone the app runs in reading-only mode for now; the iOS gate needs Apple's Screen Time entitlement (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

## Repo

```
apps/api       Hono API on Node 24: pairing, rules, books, challenges, messages, agent (Token Factory)
apps/mobile    Expo app with parent and kid modes (expo-router, src/app)
apps/mobile/modules/mello-blocker   native module: Android AccessibilityService gate, iOS stub
packages/shared   zod schemas + gate logic shared by the API and the app
```

## Run it

Requirements: Node 24, Android Studio (SDK + an emulator or a phone with USB debugging).

```sh
npm install
cp .env.example .env         # add NEBIUS_API_KEY
npm run api                  # http://localhost:8787
npm test                     # API + gate-logic tests
```

Mobile (a development build is needed because of the native module; Expo Go won't work):

```sh
cd apps/mobile
EXPO_PUBLIC_API_URL=http://10.0.2.2:8787 npx expo run:android    # emulator
# real phone: EXPO_PUBLIC_API_URL=http://<your-computer-LAN-IP>:8787
```

### Try the flow
1. On one phone or emulator, choose **I'm the parent**, create a family, and note the 6-digit code.
2. On the kid's phone, choose **This is my kid's phone** and enter the code. Then open Android **Settings → Accessibility → Mello reading gate** and turn it on.
3. Back on the parent phone, open the kid, pick an app, choose "5 minutes", and tap **Save rule**. Add the sample book under **Books** and assign it.
4. On the kid's phone, open that app. Mello opens instead, the timer runs while they read, then they take the quiz and the app opens.

Push notifications need an EAS project id (`npx eas-cli init`). Until you set one up, the kid's phone picks up rule changes and messages whenever Mello comes to the foreground.

## How the AI is used

| Feature | Endpoint | Token Factory call |
|---|---|---|
| Reading quiz | `POST /kid/challenges` | Chat completion in JSON mode, validated with zod and retried once |
| Agent | `POST /parent/agent/chat` | Tool-calling loop (list kids/apps/books, set rules, assign books, send messages, reports) |

The model is configurable with `NEBIUS_MODEL` (default `meta-llama/Llama-3.3-70B-Instruct`; it must support tool calling). If the API key is missing or Token Factory is down, the quiz is skipped and reading time alone unlocks the app, so a kid is never stuck.

## Safety
- The phone app, dialer, emergency and Settings apps can never be blocked.
- Quiz requests send the LLM only the text of the pages read and an age level. Agent requests also include your kids' first names, app lists and reading stats, because the agent needs them to act.
- Tokens are stored in the Android Keystore / iOS Keychain via `expo-secure-store`.

## Known limitations (v0.1)
- A kid can turn off the accessibility service in Settings. Settings stays unblockable on purpose so a phone can't be bricked. Planned next: report the gate's status to the parent, and use Android Device Admin / Device Owner to prevent uninstalling.
- Books are plain text pasted by the parent; EPUB import is planned.
- The parent key lives only on the phone that created the family. Multi-parent login is planned.
- The iOS gate (Screen Time extensions) is not built yet.
