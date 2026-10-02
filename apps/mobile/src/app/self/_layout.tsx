import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/lib/session';
import { stackScreenOptions } from '@/components/stackOptions';

/** Self-mode screens exist only while this phone is set up as "Just me". */
export default function SelfLayout() {
  const { session, loading } = useSession();
  if (loading) return null;
  if (session?.role !== 'self') return <Redirect href="/" />;
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ title: 'Mello' }} />
      <Stack.Screen name="focus" options={{ title: 'Focus' }} />
      <Stack.Screen name="reflect" options={{ title: 'How did it go?', gestureEnabled: false }} />
      <Stack.Screen name="insights" options={{ title: 'Your habits' }} />
      <Stack.Screen name="goals" options={{ title: 'Goals' }} />
      <Stack.Screen name="coach" options={{ title: 'Talk' }} />
      <Stack.Screen name="character" options={{ title: 'Your Mello' }} />
      <Stack.Screen name="signout" options={{ title: 'Sign out' }} />
    </Stack>
  );
}
