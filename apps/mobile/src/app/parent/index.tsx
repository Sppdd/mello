import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { Kid } from '@mello/shared';
import { parentApi, type UnpairRequest } from '@/lib/api';
import { useParentSession, useSession } from '@/lib/session';
import { Button, Card, colors, ErrorText, Field, Label, Muted, Screen, Title } from '@/components/ui';

export default function ParentHome() {
  const session = useParentSession();
  const { signOut } = useSession();
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [kids, setKids] = useState<Kid[]>([]);
  const [hasPassword, setHasPassword] = useState(false);
  const [requests, setRequests] = useState<UnpairRequest[]>([]);
  const [error, setError] = useState<unknown>(null);
  const api = useMemo(() => parentApi(session.token), [session.token]);

  const load = useCallback(() => {
    Promise.all([api.family(), api.kids(), api.unpairRequests()])
      .then(([f, k, r]) => {
        setPairingCode(f.pairingCode);
        setHasPassword(f.hasPassword);
        setKids(k);
        setRequests(r);
        setError(null);
      })
      .catch(setError);
  }, [api]);

  // No parent push yet, so check for sign-out requests every few seconds while this screen is open.
  useFocusEffect(
    useCallback(() => {
      load();
      const t = setInterval(() => api.unpairRequests().then(setRequests).catch(() => {}), 5000);
      return () => clearInterval(t);
    }, [api, load]),
  );

  const decide = (id: string, approve: boolean) => api.decideUnpair(id, approve).then(load).catch(setError);

  return (
    <Screen>
      <Title>{session.familyName}</Title>
      <ErrorText error={error} />

      {requests.map((r) => (
        <Card key={r.id}>
          <Label>{r.kidName} wants to sign out of Mello</Label>
          <Muted>Approving turns off the reading gate on their phone and unpairs it.</Muted>
          <Button title="Approve" variant="danger" onPress={() => decide(r.id, true)} />
          <Button title="Decline" variant="secondary" onPress={() => decide(r.id, false)} />
        </Card>
      ))}

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

      <SignOutPassword hasPassword={hasPassword} onSave={(p) => api.setPassword(p).then(load)} />

      <Button title="Ask Mello (agent)" onPress={() => router.push('/parent/agent')} />
      <Button title="Books" variant="secondary" onPress={() => router.push('/parent/books')} />
      <Muted>Signing out removes the parent key from this phone. Kids stay paired, but this family can't be managed again from here.</Muted>
      <Button
        title="Sign out of this phone"
        variant="danger"
        onPress={signOut}
      />
    </Screen>
  );
}

function SignOutPassword({ hasPassword, onSave }: { hasPassword: boolean; onSave: (password: string) => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  return (
    <Card>
      <Label>Kid sign-out password</Label>
      <Muted>
        {hasPassword
          ? 'Set. Entering it on a kid\'s phone signs that phone out of Mello.'
          : "Not set. Kids can still ask you to approve a sign-out, but can't sign out with a password."}
      </Muted>
      {editing ? (
        <>
          <Field label="New password (at least 4 characters)" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} />
          <ErrorText error={error} />
          <Button
            title="Save password"
            busy={busy}
            disabled={password.length < 4}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                await onSave(password);
                setPassword('');
                setEditing(false);
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          />
        </>
      ) : (
        <Button title={hasPassword ? 'Change password' : 'Set password'} variant="secondary" onPress={() => setEditing(true)} />
      )}
    </Card>
  );
}
