# Tolo in 3D: asset list, prompts and formats

Generate these in Weavy (see [weavy-tortoise-pipeline.md](weavy-tortoise-pipeline.md) for the node graph):
1. Make the **master turnaround** first.
2. Make every pose from it with an image-edit / reference-image model, so Tolo stays identical.
3. Export each pose as a **1024 px PNG with alpha** (the master copy). Then make the shipping sizes below.

## Style block (paste in front of every prompt)
> Soft 3D render of "Tolo", a small cute tortoise mascot. Clay / vinyl-toy look, rounded chunky shapes, matte materials, subtle rim light, soft studio shadow under the character, simple and readable like a premium app mascot. Dome shell in lagoon teal (#14B8A6) with a deep teal (#0F766E) hexagon pattern and one glossy gold (#FFC93C) hexagon gem on top. Apricot skin (#FFB37A), cream belly plate (#FFF4E0), round blush cheeks, big glossy dark eyes, a tiny two-leaf green sprout on its head, short stubby legs. Chibi proportions. Front three-quarter view. Transparent background, centered, no text.

**Master:**
> Character turnaround sheet: front, three-quarter, side and back views of the same character, evenly spaced, identical design in every view.

**Every pose after that:**
> Same character as the reference image: identical colours, shell pattern, gold gem, sprout, eyes and proportions. Pose: {POSE}.

## A. Floating window: head-only, shown at 28–40 dp (do these first)
Crop tight to the head plus the top of the shell, with the face filling ~70% of the frame. Check that each one still reads at 32 px.

| # | File | {POSE} | When the bubble shows it |
|---|---|---|---|
| 1 | `tolo_head_happy` | close-up of the head, warm smile, looking at the viewer | default: time left on a limited app |
| 2 | `tolo_head_focus` | close-up of the head wearing small round reading glasses, focused calm smile | focus session running |
| 3 | `tolo_head_sleepy` | close-up of the head, eyes half closed, tiny yawn | focus paused (no activity for 90 s) |
| 4 | `tolo_head_worried` | close-up of the head, raised worried eyebrows, small sweat drop | under 5 min left today |
| 5 | `tolo_head_stop` | close-up of the head, calm but firm expression, small red round stop sign beside it | limit reached |
| 6 | `tolo_head_proud` | close-up of the head, eyes closed in a proud grin, small gold sparkles | session or goal done |
| 7 | `tolo_head_wave` | head and one raised paw waving, winking | expanded bubble panel |

## B. Widgets: half or full body, shown at 80–120 dp

| # | File | {POSE} | Widget state |
|---|---|---|---|
| 8 | `tolo_proud_flame` | standing tall and proud, gold gem glowing softly, holding a small orange flame in one paw | Streak: today done |
| 9 | `tolo_peek_worried` | head peeking halfway out of the shell, worried eyebrows | Streak: at risk |
| 10 | `tolo_shell_sleep` | fully tucked inside the shell, three small "Z" shapes floating above | Guard off |
| 11 | `tolo_moon_blanket` | curled up asleep under a small lavender blanket, crescent moon and two stars above | Wind-down hours |
| 12 | `tolo_reading` | sitting, holding an open book, reading happily | Goals: reading in progress |
| 13 | `tolo_headphones` | wearing big round yellow headphones, eyes closed, gently swaying | Goals: listening in progress |
| 14 | `tolo_jump_confetti` | jumping with all feet off the ground, joyful, teal and yellow confetti | Goals: all done |
| 15 | `tolo_freeze` | sitting with a small ice cube resting on the shell, sheepish smile | Streak freeze used |
| 16 | `tolo_badge_check` | small proud bust with a green check badge (for a 1×1 widget) | Compact streak widget (optional) |

## C. In-app extras (same sheet, nice to have)
| File | {POSE} | Screen |
|---|---|---|
| `tolo_wave` | full body waving one paw high, big smile | onboarding welcome |
| `tolo_think` | sitting, paw on chin, looking up, small thought bubble | companion chat, reflection |
| `tolo_shrug` | shrugging both paws, gentle smile | stopped a session early |
| `tolo_point_phone` | pointing at a small phone showing a book icon | "back to your book" |
| `tolo_magnifier` | holding a magnifying glass, curious | empty states (no data yet) |
| `tolo_icon` | head and top of shell with the gold gem, on a teal rounded square, flat front view | app icon (also make a vector version) |

## Formats: what ships where
| Where | Format | Sizes | Notes |
|---|---|---|---|
| Floating bubble (native overlay) | **WebP**, lossy q≈85, with alpha | 48, 96, 144 px | `apps/mobile/modules/mello-blocker/android/src/main/res/drawable-nodpi/` |
| Home-screen widgets | **WebP** (or PNG) | 240 and 360 px | Widgets use Android RemoteViews: bitmaps only, no SVG, Lottie or Rive |
| In-app poses | **WebP** | 512 px | `apps/mobile/assets/tolo/`, loaded with `expo-image` |
| In-app animation | **Animated WebP** from the Weavy video loops (3–4 s, 15 fps, 512 px) | ≤ 300 KB each | Later upgrade: one Rive file with a mood input |
| App icon / store | PNG | 1024 px | Expo builds the adaptive icon from it |
| Masters | PNG with alpha | 1024 px | Keep in `docs/brand/tolo-masters/` (or a design drive) |

**Avoid** GLB/real-time 3D (too heavy, and impossible in widgets and the bubble) and SVG traced from 3D renders (it looks blotchy).

## Converting
```sh
# one master → shipping sizes (needs libwebp's cwebp)
for s in 48 96 144; do cwebp -q 85 -alpha_q 100 -resize $s $s tolo_head_happy.png -o tolo_head_happy_$s.webp; done
cwebp -q 85 -resize 512 512 tolo_reading.png -o tolo_reading.webp
# video loop → animated webp (needs ffmpeg)
ffmpeg -i tolo_idle.mp4 -vf "fps=15,scale=512:-1" -loop 0 -quality 80 tolo_idle.webp
```

## Dropping art into the app
1. Put the 512 px WebPs in `apps/mobile/assets/tolo/`.
2. Register each one in `apps/mobile/src/assets/tolo.ts` (one `require(...)` line per pose).
3. `ToloImage` shows the picture when it's registered, and the current vector drawing when not. No other code changes are needed.
