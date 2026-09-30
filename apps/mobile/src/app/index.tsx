import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSession } from '@/lib/session';

export default function Index() {
  const { session, loading } = useSession();
  if (loading)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  if (!session) return <Redirect href="/welcome" />;
  return <Redirect href={session.role === 'parent' ? '/parent' : '/kid'} />;
}
