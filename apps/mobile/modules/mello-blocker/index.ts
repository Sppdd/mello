import { Platform } from 'react-native';
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

export type InstalledApp = { packageName: string; label: string; /** ApplicationInfo.category, -1 if unknown */ androidCategory?: number };
/** Why the gate sent the kid to Mello. */
export type BlockReason = 'rule' | 'limit' | 'bedtime';
export type PendingBlock = { packageName: string; reason: BlockReason };
export type Focus = { target: string; label: string; requiredMs: number; elapsedMs: number; startedAt: number; gatedApp: string | null };
export type FocusResult = {
  target: string;
  label: string;
  elapsedMs: number;
  requiredMs: number;
  completed: boolean;
  gatedApp: string | null;
  reason: 'break_glass' | 'app_missing' | null;
};
export type UsageBetween = { apps: { packageName: string; minutes: number; opens: number }[]; screenOnMinutes: number; unlocks: number };
export type GuardStatus = { guardMinutesToday: number; breakGlassToday: number };

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
  startFocus(packageName: string, label: string, minutes: number, gatedApp: string | null): void;
  getFocus(): Focus | null;
  breakGlass(): void;
  consumeFocusResult(): FocusResult | null;
  setCharacter(name: string, color: string, lines: Record<string, string>, guardWatch: boolean): void;
  getUsageBetween(from: number, to: number): Promise<UsageBetween>;
  getGuardStatus(): GuardStatus;
  addListener(event: 'onBlockedAppOpened', listener: (e: PendingBlock) => void): EventSubscription;
  addListener(event: 'onFocusEnded', listener: () => void): EventSubscription;
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
  /** Keeps the user inside `packageName` until `minutes` of active use are in, then opens Mello. */
  startFocus: (packageName: string, label: string, minutes: number, gatedApp: string | null = null) => native?.startFocus(packageName, label, minutes, gatedApp),
  getFocus: (): Focus | null => native?.getFocus() ?? null,
  breakGlass: () => native?.breakGlass(),
  consumeFocusResult: (): FocusResult | null => native?.consumeFocusResult() ?? null,
  addFocusEndedListener(listener: () => void) {
    const sub = native?.addListener('onFocusEnded', listener);
    return () => sub?.remove();
  },
  /** The character's name, colour and lines for the bubble and guard-off reminders. guardWatch is for self mode. */
  setCharacter: (name: string, color: string, lines: Record<string, string>, guardWatch: boolean) => native?.setCharacter(name, color, lines, guardWatch),
  getUsageBetween: async (from: number, to: number): Promise<UsageBetween> =>
    (await native?.getUsageBetween(from, to)) ?? { apps: [], screenOnMinutes: 0, unlocks: 0 },
  getGuardStatus: (): GuardStatus => native?.getGuardStatus() ?? { guardMinutesToday: 0, breakGlassToday: 0 },
};
