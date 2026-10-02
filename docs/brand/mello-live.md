# Live Mello: art and motion spec

Mello appears all over the app and should feel alive. That happens in two layers.

1. **Now: the live layer in code** (`LiveMello`, `apps/mobile/src/components/Character.tsx`). It takes still frames and animates them:
   - **Breathing:** a slow 3.4 s loop.
   - **Sway and bob:** a gentle ±1.4° sway, out of phase with the breath.
   - **Blinking:** every 2.5–6 s, sometimes a double blink. It swaps in the `blink` frame.
   - **Talking:** while Mello's voice plays (`speakAs` in `src/lib/voice.ts`), it alternates the `talk` frame and the mood frame every 150 ms.
   - **Moods:** changes cross-fade in 180 ms.
   - **Tap:** a springy bounce and 1.2 s of `excited`.
   - **Reduce motion:** all loops stop when the system setting is on.
2. **Later: one Rive file** with a rigged Mello (bones and mesh deformation on the same renders). It drops into the same `LiveMello` spot, so screens don't change. See the Rive section below.

## Frames to generate (per skin)
Use the prompts in [mello-mascot-prompts.md](mello-mascot-prompts.md). Use one master image as the reference for every frame, **the same camera angle and framing for all of them** (head and shoulders, front view, centered, the same scale), so swapping frames doesn't jump.

| Frame | Expression | Used when |
|---|---|---|
| `happy` | closed gentle smile (the default) | greeting, most screens |
| `excited` | open smile, small pink tongue | tapped, a goal just completed |
| `content` | eyes closed, soft smile | calm moments |
| `curious` | head slightly tilted, bigger eyes | thinking, the coach is replying |
| `cheerful` | wink and smile | onboarding, celebrations |
| `proud` | eyes closed, big grin | streak grew, session done |
| `sleepy` | half-closed eyes, small yawn | guard off, wind-down, paused |
| `worried` | raised brows, small frown | streak at risk, limit almost used |
| `stern` | calm straight mouth | limit reached |
| `focused` | small round reading glasses | focus session |
| **`blink`** | the `happy` frame with **eyes closed**, everything else identical | the blink every few seconds |
| **`talk`** | the `happy` frame with the **mouth open mid-word**, everything else identical | while Mello speaks |

`blink` and `talk` matter most for feeling alive. Make them by **editing the `happy` image** (image-edit model: "same image, only close the eyes" / "same image, only open the mouth as if speaking"), never by generating new ones.

Start with the **Classic** skin. The other skins fall back to Classic art until they have their own.

## Files
- 512 × 512 px, transparent WebP (`cwebp -q 85 -alpha_q 100`), named `<skin>_<frame>.webp`, e.g. `classic_happy.webp`, `classic_blink.webp`.
- Put them in `apps/mobile/assets/mello/` and register each one in `apps/mobile/src/assets/mello.ts`:
  ```ts
  export const MELLO_ART = {
    classic: {
      happy: require('../../assets/mello/classic_happy.webp'),
      blink: require('../../assets/mello/classic_blink.webp'),
      talk: require('../../assets/mello/classic_talk.webp'),
      // …
    },
  };
  ```
  Anything not registered falls back to the drawn Mello, so you can add art one frame at a time.
- For the floating window and widgets, which are native Android views, see [tolo-3d-assets.md](tolo-3d-assets.md): head-only WebPs at 48/96/144 px and 240/360 px.

## Short motion clips (optional, for big moments)
For the Done screen, onboarding and the app-store video, make 3–4 s loops from the master with an image-to-video model:
> Gentle seamless idle loop of this exact character, slow breathing, one slow blink, tiny head tilt, soft 3D toy look, plain background, no camera movement.

Export as animated WebP (`ffmpeg -i in.mp4 -vf "fps=15,scale=512:-1" -loop 0 -quality 80 out.webp`, ≤ 300 KB). `expo-image` plays it.

## Later: Rive rig (the full live character)
One `mello.riv`, made in the Rive editor from the same Classic renders split into layers: shell, neck, head, jaw, eyelids and nose plate.

**Mesh deformation and bones:**
- a neck bend;
- a head tilt;
- jaw open/close;
- eyelids;
- breathing on the shell and neck.

**State machine `Mello`** with these inputs:

| Input | Type | Values |
|---|---|---|
| `mood` | number | 0 happy, 1 excited, 2 content, 3 curious, 4 cheerful, 5 proud, 6 sleepy, 7 worried, 8 stern, 9 focused |
| `talking` | boolean | true while the voice plays (lip flap driven by the rig) |
| `tap` | trigger | the bounce plus excited |
| `lookX`, `lookY` | number −1…1 | the eyes follow a point (e.g. the button being pressed) |

Blink and breathing run inside the file. Skins become a `skin` number input that swaps the texture set. In the app, `LiveMello` switches to `rive-react-native` when the file is present and passes the same props. Rive can't run in Android home-screen widgets or the native floating window: those keep the still WebPs.
