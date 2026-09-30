import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, isUnpaired, kidApi } from '@/lib/api';
import { clearKidDevice } from '@/lib/kid';
import { useKidSession, useSession } from '@/lib/session';
import { Button, Card, ErrorText, Field, Label, Muted, Screen, Title } from '@/components/ui';

const POLL_MS = 3000;

/** Signing a kid's phone out of Mello always needs a parent: their password, or their approval from the parent phone. */
export default function KidSignOut() {
  const session = useKidSession();
  const { signOut } = useSession();
  const api = useMemo(() => kidApi(session.token), [session.token]);

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const finish = useCallback(async () => {
    clearKidDevice();
    await signOut();
  }, [signOut]);

  const withPassword = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.unpairWithPassword(password);
      await finish();
    } catch (e) {
      if (isUnpaired(e)) return finish();
      setError(e instanceof ApiError && e.code === 'wrong_password' ? new Error("That password isn't right.") : e);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const askParent = async () => {
    setBusy(true);
    setError(null);
    setDenied(false);
    try {
      setRequestId((await api.requestUnpair()).id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  // Wait for the parent's answer. Approval revokes this phone, which shows up as "unpaired".
  useEffect(() => {
    if (!requestId) return;
    const t = setInterval(async () => {
      try {
        const { status } = await api.unpairStatus(requestId);
        if (status === 'denied') {
          setDenied(true);
          setRequestId(null);
        }
      } catch (e) {
        if (isUnpaired(e)) finish();
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [api, requestId, finish]);

  return (
    <Screen>
      <Title>Sign out of Mello</Title>
      <Muted>This removes Mello from this phone and turns off the reading gate. A parent has to say yes.</Muted>

      <Card>
        <Label>Parent enters their password</Label>
        <Field
          label="Parent password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={withPassword}
        />
        <Button title="Sign out" busy={busy && !requestId} disabled={!password} onPress={withPassword} />
      </Card>

      <Card>
        <Label>Or ask for approval</Label>
        {requestId ? (
          <>
            <Muted>Waiting for your parent to approve on their phone…</Muted>
            <Button title="Cancel" variant="secondary" onPress={() => setRequestId(null)} />
          </>
        ) : (
          <>
            <Muted>Your parent gets a request in their Mello app and can approve or decline it.</Muted>
            <Button title="Ask parent to approve" variant="secondary" busy={busy} onPress={askParent} />
          </>
        )}
        {denied && <Muted>Your parent said no this time.</Muted>}
      </Card>

      <ErrorText error={error} />
    </Screen>
  );
}
