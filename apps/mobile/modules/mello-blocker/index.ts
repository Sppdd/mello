import { Platform } from 'react-native';
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

export type InstalledApp = { packageName: string; label: string };
/** Why the gate sent the kid to Mello. */
export type BlockReason = 'rule' | 'limit' | 'bedtime';
export type PendingBlock = { packageName: string; reason: BlockReason };

type MelloBlockerNative = {
  isSupported(): boolean;
  isServiceEnabled(): boolean;
  openServiceSettings(): void;
  getInstalledApps(): Promise<InstalledApp[]>;
  setBlockedPackages(packages: string[]): void;
  setLimits(limits: Record<string, number>): void;
  setQuietHours(enabled: boolean, startMinute: number, endMinute: number, allowed: string[]): void;
  setBubble(enabled: boolean, lines: string[]): void;
  isUsageAccessGranted(): boolean;
  openUsageAccessSettings(): void;
  getUsageToday(): Promise<Record<string, number>>;
  unlock(packageName: string, minutes: number): void;
  getUnlocks(): Record<string, number>;
  consumePendingBlockedApp(): PendingBlock | null;
  launchApp(packageName: string): boolean;
  addListener(event: 'onBlockedAppOpened', listener: (e: PendingBlock) => void): EventSubscription;
};

// Optional so the JS still runs in Expo Go or on web, where the native side is missing.
const native = requireOptionalNativeModule<MelloBlockerNative>('MelloBlocker');

export const MelloBlocker = {
  isSupported: () => Platform.OS === 'android' && !!native?.isSupported(),
  isServiceEnabled: () => native?.isServiceEnabled() ?? false,
  openServiceSettings: () => native?.openServiceSettings(),
  getInstalledApps: async () => (await native?.getInstalledApps()) ?? [],
  setBlockedPackages: (packages: string[]) => native?.setBlockedPackages(packages),
  setLimits: (limits: Record<string, number>) => native?.setLimits(limits),
  setQuietHours: (q: { enabled: boolean; startMinute: number; endMinute: number; allowedApps: string[] } | null) =>
    native?.setQuietHours(!!q?.enabled, q?.startMinute ?? 0, q?.endMinute ?? 0, q?.allowedApps ?? []),
  setBubble: (enabled: boolean, lines: string[]) => native?.setBubble(enabled, lines),
  isUsageAccessGranted: () => native?.isUsageAccessGranted() ?? false,
  openUsageAccessSettings: () => native?.openUsageAccessSettings(),
  getUsageToday: async (): Promise<Record<string, number>> => (await native?.getUsageToday()) ?? {},
  unlock: (packageName: string, minutes: number) => native?.unlock(packageName, minutes),
  getUnlocks: (): Record<string, number> => native?.getUnlocks() ?? {},
  consumePendingBlockedApp: (): PendingBlock | null => native?.consumePendingBlockedApp() ?? null,
  launchApp: (packageName: string) => native?.launchApp(packageName) ?? false,
  addBlockedListener(listener: (block: PendingBlock) => void) {
    const sub = native?.addListener('onBlockedAppOpened', listener);
    return () => sub?.remove();
  },
};
