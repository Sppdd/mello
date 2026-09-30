import { Platform } from 'react-native';
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

export type InstalledApp = { packageName: string; label: string };

type MelloBlockerNative = {
  isSupported(): boolean;
  isServiceEnabled(): boolean;
  openServiceSettings(): void;
  getInstalledApps(): Promise<InstalledApp[]>;
  setBlockedPackages(packages: string[]): void;
  unlock(packageName: string, minutes: number): void;
  getUnlocks(): Record<string, number>;
  consumePendingBlockedApp(): string | null;
  launchApp(packageName: string): boolean;
  addListener(event: 'onBlockedAppOpened', listener: (e: { packageName: string }) => void): EventSubscription;
};

// Optional so the JS still runs in Expo Go or on web, where the native side is missing.
const native = requireOptionalNativeModule<MelloBlockerNative>('MelloBlocker');

export const MelloBlocker = {
  isSupported: () => Platform.OS === 'android' && !!native?.isSupported(),
  isServiceEnabled: () => native?.isServiceEnabled() ?? false,
  openServiceSettings: () => native?.openServiceSettings(),
  getInstalledApps: async () => (await native?.getInstalledApps()) ?? [],
  setBlockedPackages: (packages: string[]) => native?.setBlockedPackages(packages),
  unlock: (packageName: string, minutes: number) => native?.unlock(packageName, minutes),
  getUnlocks: (): Record<string, number> => native?.getUnlocks() ?? {},
  consumePendingBlockedApp: () => native?.consumePendingBlockedApp() ?? null,
  launchApp: (packageName: string) => native?.launchApp(packageName) ?? false,
  addBlockedListener(listener: (packageName: string) => void) {
    const sub = native?.addListener('onBlockedAppOpened', (e) => listener(e.packageName));
    return () => sub?.remove();
  },
};
