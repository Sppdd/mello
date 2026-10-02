import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { SessionProvider, useSession } from '@/lib/session';
import { stackScreenOptions } from '@/components/stackOptions';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="dark" />
      <RootStack />
    </SessionProvider>
  );
}

/**
 * The navigator is keyed by this phone's role. Signing in or out (or the backend unpairing the phone)
 * remounts it with fresh history, so Back can never reach the other side's screens. The kid/ and
 * parent/ layouts redirect away if the role doesn't match.
 */
function RootStack() {
  const { session } = useSession();
  const role = session?.role ?? 'none';

  return (
    <Stack key={role} screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="welcome" options={{ title: 'Welcome to Mello', headerBackVisible: false }} />
      <Stack.Screen name="parent" options={{ headerShown: false }} />
      <Stack.Screen name="kid" options={{ headerShown: false }} />
      <Stack.Screen name="self" options={{ headerShown: false }} />
      <Stack.Screen name="setup-self" options={{ title: 'Just me', headerBackVisible: false }} />
    </Stack>
  );
}
