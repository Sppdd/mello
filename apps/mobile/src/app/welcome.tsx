import { useState } from 'react';
import { Redirect } from 'expo-router';
import { publicApi } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button, Card, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';

export default function Welcome() {
  const { session, signIn } = useSession();
  const [mode, setMode] = useState<'choose' | 'parent' | 'kid'>('choose');
  const [familyName, setFamilyName] = useState('');
  const [code, setCode] = useState('');
  const [kidName, setKidName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (session) return <Redirect href="/" />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      // The root layout moves to the right home screen once the session changes.
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'parent')
    return (
      <Screen>
        <Title>Set up your family</Title>
        <Muted>This phone becomes the parent phone. You will get a 6-digit code to pair each kid's phone.</Muted>
        <Field label="Family name" value={familyName} onChangeText={setFamilyName} placeholder="The Smiths" />
        <ErrorText error={error} />
        <Button
          title="Create family"
          busy={busy}
          disabled={!familyName.trim()}
          onPress={() =>
            run(async () => {
              const f = await publicApi.createFamily(familyName.trim());
              await signIn({ role: 'parent', token: f.parentToken, familyName: familyName.trim() });
            })
          }
        />
        <Button title="Back" variant="secondary" onPress={() => setMode('choose')} />
      </Screen>
    );

  if (mode === 'kid')
    return (
      <Screen>
        <Title>Pair this phone</Title>
        <Muted>Enter the code shown on your parent's phone.</Muted>
        <Field label="Pairing code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" placeholder="123456" />
        <Field label="Your first name" value={kidName} onChangeText={setKidName} placeholder="Sara" />
        <ErrorText error={error} />
        <Button
          title="Pair"
          busy={busy}
          disabled={code.length !== 6 || !kidName.trim()}
          onPress={() =>
            run(async () => {
              const k = await publicApi.pair(code, kidName.trim());
              await signIn({ role: 'kid', token: k.deviceToken, kidId: k.kidId, kidName: kidName.trim() });
            })
          }
        />
        <Button title="Back" variant="secondary" onPress={() => setMode('choose')} />
      </Screen>
    );

  return (
    <Screen>
      <Title>Who uses this phone?</Title>
      <Card>
        <Muted>Parents set reading rules, pick books and send voice messages.</Muted>
        <Button title="I'm the parent" onPress={() => setMode('parent')} />
      </Card>
      <Card>
        <Muted>Kids read a little before opening the apps their parent picked.</Muted>
        <Button title="This is my kid's phone" variant="secondary" onPress={() => setMode('kid')} />
      </Card>
    </Screen>
  );
}
