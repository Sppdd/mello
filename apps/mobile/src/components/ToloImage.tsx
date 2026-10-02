import type { ReactNode } from 'react';
import { Image } from 'expo-image';
import { TOLO_IMAGES, type ToloPose } from '@/assets/tolo';

/** Tolo's 3D render for a pose when it has been added, otherwise `fallback` (the vector character). */
export function ToloImage({ pose, size = 96, fallback }: { pose: ToloPose; size?: number; fallback: ReactNode }) {
  const source = TOLO_IMAGES[pose];
  if (!source) return <>{fallback}</>;
  return <Image source={source} style={{ width: size, height: size }} contentFit="contain" accessibilityLabel={`Tolo, ${pose.replace(/_/g, ' ')}`} transition={150} />;
}
