> **Update:** the tortoise is now called **Mello** and follows the new character sheet (see [mello-mascot-prompts.md](mello-mascot-prompts.md) and [mello-live.md](mello-live.md)). The pose list and formats below still apply; read "Tolo" as "Mello".

# Tolo the tortoise: Weavy pipeline blueprint

This is a node pipeline to build in [Weavy](https://app.weavy.ai) (New file → "Tolo – Mello mascot pipeline"). It makes Mello's tortoise mascot, poses that each mean something in the app, a logo, app layouts and short animations.

Pick models from whatever Weavy lists at the time. Each node says which *kind* of model it needs. Every prompt below is ready to paste.

To have Claude build it for you, run Claude Code locally with a browser MCP (Claude in Chrome, or the `chrome-devtools` / Playwright MCP), open Weavy, and give it this file.

---

## 1. Character brief

**Tolo** is a small tortoise and Mello's companion. Slow and steady: small steps make a path.

**Style**
- Modern flat vector mascot, Duolingo-level simplicity but its own look.
- Chunky rounded shapes and thick soft outlines in dark plum.
- Big expressive eyes and round cheeks.
- One flat shadow tone, no gradients, no texture.
- Reads clearly at 48 px.

**Palette** (deliberately not Duolingo green)

| Role | Name | Hex |
|---|---|---|
| Shell | lagoon teal | `#14B8A6` |
| Shell pattern | deep teal | `#0F766E` |
| Skin | apricot | `#FFB37A` |
| Belly / plastron | cream | `#FFF4E0` |
| Outline / ink | dark plum | `#2B1B3D` |
| Accent (gem, sparkles, UI) | sunflower | `#FFC93C` |
| App background | warm cream | `#FFF9F0` |

**Fixed traits.** Repeat these in every prompt; they keep Tolo consistent.
1. A dome shell with a hexagon pattern, and **one gold hexagon on top** (the "streak gem").
2. A **tiny two-leaf sprout** on top of the head.
3. Round apricot cheeks and big glossy dark eyes with one white highlight.
4. Short stubby legs and a short tail.
5. Proportions: the head is about 45% of the body height (chibi).

---

## 2. Poses and what they mean in Mello

| # | Pose | Meaning | Mello event |
|---|---|---|---|
| 1 | Waving one front foot, big smile | Hello | `greet` |
| 2 | Sitting, reading an open book on its belly | Reading focus | focus: reading |
| 3 | Big headphones, eyes closed, gently swaying | Listening focus | focus: listening |
| 4 | Standing tall, gem glowing, holding a small flame | Proud, streak grew | `streak_up` |
| 5 | Head half out of the shell, worried brows | Streak at risk | `streak_risk` |
| 6 | Fully inside the shell, "Zzz" above | Guard switched off | `guard_off` |
| 7 | Shrugging, gentle smile | "That's okay" | `break_glass` |
| 8 | Curled up under a crescent moon, small blanket | Wind-down / bedtime | quiet hours |
| 9 | Jumping, confetti around | Goal done | `focus_done` |
| 10 | Chin on foot, thought bubble | Thinking / asking | coach, reflection |
| 11 | Pointing toward a phone that shows a book icon | "Back to your book" | `bounce` |
| 12 | Calmly holding up a small round stop sign | Limit reached | daily limit |

---

## 3. The Weavy graph

```
[A1 Brief text] → [A2 LLM: prompt writer] → [A3 12 pose prompts]
        │                                           │
        └→ [B1 Image: character sheet] → [B2 Remove BG] → [B3 Upscale] = REFERENCE
                                                    │
               ┌────────────────────────────────────┼─────────────────────────┐
               ▼                                    ▼                         ▼
   [C1..C12 Image edit + ref]          [D1 Vector: icon] [D2 Vector/Ideogram: wordmark]
               │                                    │
   [Remove BG → Export PNG]            [E1–E3 Image: app layouts (ref + logo)]
               │
   [F1–F4 Image→Video loops] → [G Export board]
```

### Stage A: brief to prompts
**A1 · Text node "Brand brief":** paste sections 1 and 2 of this file.

**A2 · LLM node** (any strong text model). Connect A1 and use this prompt:
> You write image prompts for a mascot. From the brief, write one master prompt for a character turnaround sheet, then 12 pose prompts (one per row of the pose table). Every prompt must repeat the fixed traits and the palette hex codes word for word, say "flat vector mascot illustration, thick dark plum outline, one flat shadow tone, transparent background", and describe only the pose and props in addition. Output exactly 13 lines, no numbering.

**A3:** split A2's output into 13 text nodes, or skip A2 and use the ready-made prompts below.

### Stage B: master reference
**B1 · Image node** (best illustration model available: GPT Image, Imagen, Flux Pro or similar). Generate 4 variants and keep the best:
> Character turnaround sheet of "Tolo", a small cute tortoise mascot for a habits app. Front view, three-quarter view, side view, back view, evenly spaced on a plain white background. Flat vector mascot illustration, modern and friendly, chunky rounded shapes, thick dark plum outline (#2B1B3D), one flat shadow tone, no gradients. Dome shell in lagoon teal (#14B8A6) with a deep teal (#0F766E) hexagon pattern and one gold (#FFC93C) hexagon on top. Apricot skin (#FFB37A), cream belly (#FFF4E0), round apricot cheeks, big glossy dark eyes with one white highlight, a tiny two-leaf sprout on its head, short stubby legs, chibi proportions (head about 45% of height). Consistent design in all four views.

**B2 · Remove background**, then **B3 · Upscale** (2×). B3 is the **reference image** for everything below.

### Stage C: the 12 poses
For each pose, add an **image-edit / reference-image node** (Flux Kontext, Gemini "Nano Banana" image edit, GPT Image edit or similar). Use B3 as the reference and this prompt template:

> Same character as the reference image: identical colours, shell pattern, gold hexagon gem, head sprout, eyes and proportions. Flat vector mascot illustration, thick dark plum outline, one flat shadow tone, transparent background, centered, full body. Pose: **{POSE}**.

`{POSE}` values:
1. waving one front foot high, big open smile, slight head tilt
2. sitting, holding an open book on its belly, reading with a calm smile
3. wearing big round sunflower-yellow headphones, eyes closed happily, leaning slightly to one side as if swaying to audio
4. standing tall and proud, chest out, the gold shell gem glowing with small sparkles, holding a small orange flame in one front foot
5. head only halfway out of the shell, eyebrows raised with worry, small sweat drop
6. completely pulled inside its shell, only the shell visible with the gold gem, three small "Z" letters floating above
7. shrugging both front feet, eyebrows relaxed, gentle closed-mouth smile
8. curled up asleep under a small cream blanket, a sunflower-yellow crescent moon and two tiny stars above
9. jumping in the air with all feet off the ground, joyful open smile, teal and yellow confetti around
10. sitting, chin resting on one front foot, looking up thoughtfully, a small empty thought bubble above
11. standing beside a small phone whose screen shows a simple book icon, pointing at it with one front foot, encouraging smile
12. calmly holding up a small round red stop sign with a white hand icon, friendly but firm expression

After each: **Remove background** → **Export** as PNG at 1024 px and 256 px. Name the files `tolo-01-greet.png` … `tolo-12-limit.png`.

### Stage D: logo
**D1 · Vector model** (Recraft vector/SVG or similar). Use the reference, export SVG:
> App icon: Tolo the tortoise's head and the top of its shell, front view, centered on a rounded square in lagoon teal (#14B8A6); the gold hexagon gem visible on the shell; simple flat vector, thick dark plum outline, no text, readable at 48 px.

**D2 · Vector model or Ideogram** (whichever renders text cleanly). Generate 4 and pick one; check the spelling:
> Wordmark logo reading exactly "mello" in lowercase, rounded geometric sans-serif, dark plum (#2B1B3D) on warm cream (#FFF9F0); the letter "o" contains a small gold (#FFC93C) hexagon; flat, minimal, no mascot.

**D3 (optional) · Lockup:** the icon on the left and the wordmark on the right, on cream.

### Stage E: app layouts
Image nodes, with B3 and D2 connected as references:

**E1 · Home**
> Mobile app screen mockup, 9:19.5, warm cream (#FFF9F0) background. Top: Tolo waving next to a white speech bubble "Hi Sara! Ready for a calm, good day?". Below: a white rounded card with a flame and "5-day streak". Then a card "Today" with two checklist rows "20 min in ReadEra" and "15 min Audible", a teal (#14B8A6) "Focus now" button. Clean modern UI, rounded corners 14 px, plum text, flat style matching the mascot.

**E2 · Focus**
> Mobile app screen mockup: Tolo reading a book at the top; big "12 min" timer, "left in ReadEra"; a teal "Back to ReadEra" button; below, a soft outlined "Hold to stop" button. Warm cream background, flat friendly UI.

**E3 · Bubble over a social app**
> Phone screen showing a blurred generic social feed; at the top right a small teal pill bubble "Tolo · 12 min left today" with Tolo's tiny head icon. Flat UI, no real brand logos.

(Optional) **Compositor / layers node:** place the real pose PNGs from Stage C onto these layouts instead of the generated mascot.

### Stage F: motion
**Image-to-video node** (Kling, Veo, Runway, Seedance or similar), 3–5 s, for poses 1, 2, 6 and 9:
> Gentle seamless idle loop of this exact character, subtle bounce and blink, flat 2D animation look, plain background, no camera movement, no new objects.

These become in-app animations later: retrace them in Lottie or Rive.

### Stage G: export board
Collect everything on one **output / export** node:
- the character sheet;
- the 12 poses (1024 + 256);
- the icon (SVG + 1024 PNG);
- the wordmark;
- 3 layouts and 4 loops.

---

## 4. Quality checks
- **Consistency:** shell pattern, gold gem, sprout and colours match the reference in every pose. Regenerate any outlier from B3, not from another pose.
- **Small sizes:** the icon and poses still read at 48 px. If not, thicken the outline and simplify the shell pattern.
- **Text:** the wordmark reads exactly "mello". Image models often misspell text.
- **Licensing:** check Weavy's and each model's commercial-use terms before shipping.

## 5. Bringing Tolo into the app (later)
- Add a `tolo` character (species "tortoise") to `packages/shared/src/characters.ts`, with lines per event.
- In `apps/mobile/src/components/Character.tsx`, map moods to the exported PNGs. Use the pose table: greet → happy, streak_up → proud, guard_off → sleepy, streak_risk → worried, limit → stern.
- Optionally make Tolo the default companion and use D1 as the app icon.
