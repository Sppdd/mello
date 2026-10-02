import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { Alert, Kid } from '@mello/shared';
import { ApiError, parentApi, type Family, type UnpairRequest } from '@/lib/api';
import { useParentSession, useSession } from '@/lib/session';
import { Button, Card, colors, ErrorText, Field, Label, Muted, Screen, Title } from '@/components/ui';

export default function ParentHome() {
  const session = useParentSession();
  const { signOut } = useSession();
  const [family, setFamily] = useState<Family | null>(null);
  const [noFamily, setNoFamily] = useState(false);
  const [kids, setKids] = useState<Kid[]>([]);
  const [hasPassword, setHasPassword] = useState(false);
  const [requests, setRequests] = useState<UnpairRequest[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<unknown>(null);
  const api = useMemo(() => parentApi(), []);

  const load = useCallback(() => {
    Promise.all([api.family(), api.kids(), api.unpairRequests(), api.alerts()])
      .then(([f, k, r, a]) => {
        setAlerts(a);
        setFamily(f);
        setNoFamily(false);
        setHasPassword(f.hasPassword);
        setKids(k);
        setRequests(r);
        setError(null);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.code === 'no_family') setNoFamily(true);
        else setError(e);
      });
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

  if (noFamily) return <CreateFamily email={session.email} onCreate={(name) => api.createFamily(name).then(load)} onSignOut={signOut} />;

  return (
    <Screen>
      <Title>{family?.name ?? 'Family'}</Title>
      <Muted>Signed in as {session.email}</Muted>
      <ErrorText error={error} />

      {requests.map((r) => (
        <Card key={r.id}>
          <Label>{r.kidName} wants to sign out of Mello</Label>
          <Muted>Approving turns off the reading gate on their phone and unpairs it.</Muted>
          <Button title="Approve" variant="danger" onPress={() => decide(r.id, true)} />
          <Button title="Decline" variant="secondary" onPress={() => decide(r.id, false)} />
        </Card>
      ))}

      {alerts.length > 0 && (
        <Card>
          <Label>Alerts</Label>
          {alerts.slice(0, 5).map((a) => (
            <Muted key={a.id}>
              {new Date(a.createdAt).toLocaleString()} · {a.kidName}: {describeAlert(a, kids)}
            </Muted>
          ))}
          <Button title="Mark as seen" variant="secondary" onPress={() => api.alertsSeen().then(load).catch(setError)} />
        </Card>
      )}

      <Card>
        <Label>Pair a kid's phone</Label>
        <Muted>Install Mello on their phone, choose "This is my kid's phone", and enter:</Muted>
        <Text style={{ fontSize: 34, fontWeight: '700', letterSpacing: 6, color: colors.primary }}>{family?.pairingCode ?? '······'}</Text>
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

function CreateFamily({ email, onCreate, onSignOut }: { email: string; onCreate: (name: string) => Promise<unknown>; onSignOut: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Screen>
      <Title>Set up your family</Title>
      <Muted>Signed in as {email}. Name your family to get a code for pairing your kids' phones.</Muted>
      <Field label="Family name" value={name} onChangeText={setName} placeholder="The Smiths" />
      <ErrorText error={error} />
      <Button
        title="Create family"
        busy={busy}
        disabled={!name.trim()}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            await onCreate(name.trim());
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button title="Sign out" variant="secondary" onPress={onSignOut} />
    </Screen>
  );
}

function describeAlert(a: Alert, kids: Kid[]): string {
  const pkg = typeof a.detail.app === 'string' ? a.detail.app : null;
  const app = pkg ? (kids.find((k) => k.id === a.kidId)?.installedApps.find((x) => x.packageName === pkg)?.label ?? pkg) : 'an app';
  switch (a.kind) {
    case 'protection_off':
      return a.detail.protection === 'gateEnabled' ? 'turned off the Mello reading gate' : `turned off ${String(a.detail.protection)}`;
    case 'bedtime_attempt':
      return `tried to open ${app} at bedtime`;
    case 'limit_reached':
      return `reached today's limit for ${app}`;
    default:
      return a.kind;
  }
}
