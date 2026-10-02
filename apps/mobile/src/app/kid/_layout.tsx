import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/lib/session';
import { stackScreenOptions } from '@/components/stackOptions';

/** Kid screens exist only while this phone is paired as a kid. */
export default function KidLayout() {
  const { session, loading } = useSession();
  if (loading) return null;
  if (session?.role !== 'kid') return <Redirect href="/" />;
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ title: 'Mello' }} />
      <Stack.Screen name="read" options={{ title: 'Reading', gestureEnabled: false }} />
      <Stack.Screen name="signout" options={{ title: 'Sign out' }} />
      <Stack.Screen name="buddy" options={{ title: 'Your buddy' }} />
    </Stack>
  );
}
