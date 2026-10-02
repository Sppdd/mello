import type { ImageSource } from 'expo-image';
import type { Mood, Skin } from '@mello/shared';

/**
 * Mello's rendered art, by skin and frame. Drop 512 px transparent WebPs into apps/mobile/assets/mello/
 * and register them here, e.g.
 *   classic: { happy: require('../../assets/mello/classic_happy.webp'), blink: require('../../assets/mello/classic_blink.webp') },
 * `blink` (eyes closed) and `talk` (mouth open) are the frames the live layer swaps in for blinking and
 * speaking. Anything missing falls back to the drawn Mello. Spec: docs/brand/mello-live.md.
 */
export type Frame = Mood | 'blink' | 'talk';

export const MELLO_ART: Partial<Record<Skin, Partial<Record<Frame, ImageSource | number>>>> = {};

/** The art for a frame: this skin first, then the classic skin; `null` means use the drawing. */
export function melloArt(skin: Skin, frame: Frame): ImageSource | number | null {
  return MELLO_ART[skin]?.[frame] ?? MELLO_ART.classic?.[frame] ?? null;
}
