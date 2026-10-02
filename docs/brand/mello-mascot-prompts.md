# Mello mascot prompts: from the realistic tortoise to a Duolingo-style character

Start from the realistic giant-tortoise sheet: keep its face and body shape, and make it bold, simple, colourful and readable at small sizes.

## What to keep from the reference (the "face DNA")
- A wide, rounded, slightly flat-topped head that's bigger than real (chibi).
- Large glossy dark eyes set wide on the sides, with a soft upper lid.
- The pale vertical **nose-ridge plate** between the eyes, down to two small nostrils. This is its signature.
- A long, gentle, closed smile across the whole face, with a soft lighter jaw.
- A long neck with a few soft skin folds, a domed shell, and stumpy elephant-like legs.

## What changes
- Realistic wrinkles and scales become **smooth stylised 3D (vinyl toy / clay)** with a few graphic folds. No photographic texture.
- Grey-brown becomes a **signature colourway** (below). Silhouette and face stay identical.
- Proportions push cuter: head about 40% of height, shorter neck, rounder shell, bigger eyes.

## Prompts

**1. Master character (image-to-image, the reference attached).** Reference strength about 0.55–0.65 keeps the face but lets the style change.
> Stylized 3D mascot of Mello, a friendly giant tortoise, redesigned from the reference: keep the exact face shape — wide rounded head, big glossy dark eyes set wide, the pale vertical nose-ridge plate with two small nostrils, and the long gentle closed smile. Turn it into a bold, simple, playful app mascot in the spirit of Duolingo's characters: smooth soft-vinyl / clay toy look, chunky rounded shapes, chibi proportions (big head, short neck, round domed shell, stubby round feet), clean surfaces with only a few soft graphic skin folds, no realistic wrinkles or scales. Colors: skin in warm apricot (#FFB37A) with a cream (#FFF4E0) jaw and nose plate, shell in vivid lagoon teal (#14B8A6) with deep teal (#0F766E) hexagon plates and one glossy sunflower-gold (#FFC93C) hexagon gem on top, eyes dark plum (#2B1B3D) with a bright white highlight, soft pink cheeks. Soft studio lighting, gentle rim light, subtle contact shadow, plain warm cream background. Front three-quarter view, full body, centered. Cheerful, kind, slightly cheeky.

**Negative prompt** (if the model supports one):
> photorealistic, realistic skin texture, wrinkles, scales, fur, horror, creepy, uncanny, teeth, sharp beak, dull grey, muddy brown, cluttered background, text, watermark, extra limbs, extra eyes

**2. Turnaround sheet** (feed the master back in as the reference):
> Character turnaround sheet of the same Mello tortoise mascot: front, three-quarter, side and back views on a plain cream background, identical colors, proportions, shell pattern and gold gem in every view, soft 3D vinyl style, even spacing, no text.

**3. Expression sheet** (head and shoulders, same reference):
> Expression sheet of the same Mello tortoise mascot, head and shoulders, 8 tiles on cream: happy (closed smile), excited (open smile, tiny pink tongue), proud (eyes closed, big grin, gold sparkles), curious (head tilted, one brow up), sleepy (half-closed eyes, small yawn), worried (raised brows, small sweat drop), focused (small round reading glasses, calm smile), firm (calm straight mouth, slight frown). Same face shape, nose plate and colors in every tile. Soft 3D vinyl style.

**4. Poses for the app** (one per image; the template plus a pose):
> The same Mello tortoise mascot, identical design and colors, soft 3D vinyl style, transparent background, full body, centered. Pose: {POSE}.

| {POSE} | Used for |
|---|---|
| waving one front foot, big smile | welcome / greet |
| sitting, reading an open book | reading focus |
| wearing big round yellow headphones, eyes closed, swaying | listening focus |
| standing tall, gold gem glowing, holding a small flame | streak up |
| head peeking out of the shell, worried | streak at risk |
| fully tucked in its shell, three floating "Z" shapes | guard off |
| curled up under a lavender blanket, crescent moon above | wind-down |
| jumping, all feet off the ground, confetti | goal done |

**5. App icon:**
> App icon: the Mello tortoise's head and the top of its shell, front view, centered on a rounded square of lagoon teal (#14B8A6), soft 3D vinyl style, big friendly eyes, the cream nose plate and gentle smile clearly readable at small size, no text.

**6. Floating-window head** (tiny, about 32 px):
> Close-up of the Mello tortoise mascot's head only, front view, face filling 75% of the frame, simplified details so it reads at 32 pixels, transparent background, {EXPRESSION}.

## Optional colourways (to make it "for everyone")
Same prompt, swap only the colour sentence. These work as unlockable skins:
- **Lagoon (default):** apricot skin, teal shell, gold gem (as above).
- **Berry:** lilac skin (#C9B6FF), raspberry shell (#E0457B) with plum (#7A1F4A) plates, mint gem (#7CF0C5).
- **Sunny:** butter-yellow skin (#FFD66B), coral shell (#FF6B5B) with brick (#B8392C) plates, sky-blue gem (#5BC0FF).
- **Night:** soft periwinkle skin (#9DB4FF), midnight-indigo shell (#2E3A8C) with starry navy (#1A2156) plates, silver gem (#E6ECFF).

## Tips
- Generate the master first and pick the best, then use it as the only reference for everything else. Never reference a pose from another pose.
- Export 1024 px PNG with alpha, then convert to WebP as in `docs/brand/tolo-3d-assets.md`.
- Name: the reference sheet calls it "Mello", but earlier docs called the tortoise "Tolo". The prompts use "Mello". If you keep "Tolo" for the character and "Mello" for the app, swap the word.
