import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { SessionProvider } from '@/lib/session';
import { colors } from '@/components/ui';

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
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="welcome" options={{ title: 'Welcome to Mello' }} />
        <Stack.Screen name="parent/index" options={{ title: 'Family' }} />
        <Stack.Screen name="parent/kid/[id]" options={{ title: 'Kid' }} />
        <Stack.Screen name="parent/books" options={{ title: 'Books' }} />
        <Stack.Screen name="parent/agent" options={{ title: 'Ask Mello' }} />
        <Stack.Screen name="kid/index" options={{ title: 'Mello' }} />
        <Stack.Screen name="kid/read" options={{ title: 'Reading', gestureEnabled: false }} />
      </Stack>
    </SessionProvider>
  );
}
