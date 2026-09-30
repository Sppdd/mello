import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/lib/session';
import { stackScreenOptions } from '@/components/stackOptions';

/** Parent screens exist only while this phone holds the parent key. */
export default function ParentLayout() {
  const { session, loading } = useSession();
  if (loading) return null;
  if (session?.role !== 'parent') return <Redirect href="/" />;
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ title: 'Family' }} />
      <Stack.Screen name="kid/[id]" options={{ title: 'Kid' }} />
      <Stack.Screen name="books" options={{ title: 'Books' }} />
      <Stack.Screen name="agent" options={{ title: 'Ask Mello' }} />
    </Stack>
  );
}
