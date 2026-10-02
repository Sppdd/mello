import type { ImageSource } from 'expo-image';

/**
 * Tolo's 3D renders, by pose. Drop a 512 px WebP into apps/mobile/assets/tolo/ and add one line here,
 * e.g. `reading: require('../../assets/tolo/tolo_reading.webp'),`. Poses without a file fall back
 * to the vector drawing. Pose names and prompts: docs/brand/tolo-3d-assets.md.
 */
export type ToloPose =
  | 'wave'
  | 'reading'
  | 'headphones'
  | 'proud_flame'
  | 'peek_worried'
  | 'shell_sleep'
  | 'moon_blanket'
  | 'jump_confetti'
  | 'freeze'
  | 'think'
  | 'shrug'
  | 'point_phone'
  | 'magnifier';

export const TOLO_IMAGES: Partial<Record<ToloPose, ImageSource | number>> = {};
