import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { Kid } from '@mello/shared';
import { parentApi } from '@/lib/api';
import { useParentSession, useSession } from '@/lib/session';
import { Button, Card, colors, ErrorText, Label, Muted, Screen, Title } from '@/components/ui';

export default function ParentHome() {
  const session = useParentSession();
  const { signOut } = useSession();
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [kids, setKids] = useState<Kid[]>([]);
  const [error, setError] = useState<unknown>(null);

  useFocusEffect(
    useCallback(() => {
      const api = parentApi(session.token);
      Promise.all([api.family(), api.kids()])
        .then(([f, k]) => {
          setPairingCode(f.pairingCode);
          setKids(k);
          setError(null);
        })
        .catch(setError);
    }, [session.token]),
  );

  return (
    <Screen>
      <Title>{session.familyName}</Title>
      <ErrorText error={error} />

      <Card>
        <Label>Pair a kid's phone</Label>
        <Muted>Install Mello on their phone, choose "This is my kid's phone", and enter:</Muted>
        <Text style={{ fontSize: 34, fontWeight: '700', letterSpacing: 6, color: colors.primary }}>{pairingCode ?? '······'}</Text>
      </Card>

      <Label>Kids</Label>
      {kids.length === 0 && <Muted>No kids paired yet.</Muted>}
      {kids.map((kid) => (
        <Pressable key={kid.id} onPress={() => router.push({ pathname: '/parent/kid/[id]', params: { id: kid.id, name: kid.name } })}>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Label>{kid.name}</Label>
              <Muted>›</Muted>
            </View>
            <Muted>{kid.installedApps.length ? `${kid.installedApps.length} apps on phone` : 'Waiting for phone to sync'}</Muted>
          </Card>
        </Pressable>
      ))}

      <Button title="Ask Mello (agent)" onPress={() => router.push('/parent/agent')} />
      <Button title="Books" variant="secondary" onPress={() => router.push('/parent/books')} />
      <Muted>Signing out removes the parent key from this phone. Kids stay paired, but this family can't be managed again from here.</Muted>
      <Button
        title="Sign out of this phone"
        variant="danger"
        onPress={async () => {
          router.replace('/welcome');
          await signOut();
        }}
      />
    </Screen>
  );
}
