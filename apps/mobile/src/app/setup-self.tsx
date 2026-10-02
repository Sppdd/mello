import { useState } from 'react';
import { Redirect } from 'expo-router';
import { CharacterPrefs } from '@mello/shared';
import { selfApi } from '@/lib/api';
import { useSession } from '@/lib/session';
import { CharacterSays } from '@/components/Character';
import { Button, Card, ErrorText, Field, Label, Muted, Screen, Title } from '@/components/ui';

/**
 * "Just me": a signed-in user sets Mello up to coach their own phone. Creates their self subject
 * (or moves it to this phone) and stores the device token like a paired kid phone would.
 */
export default function SetupSelf() {
  const { session, intent, setIntent, signInSelf } = useSession();
  const [name, setName] = useState('');
  const [character] = useState<CharacterPrefs>(() => CharacterPrefs.parse({}));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (session?.role !== 'parent' || intent !== 'self') return <Redirect href="/" />;

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const api = selfApi();
      const { subjectId, deviceToken } = await api.setup(name.trim());
      await signInSelf({ role: 'self', userId: session.userId, token: deviceToken, subjectId, name: name.trim() });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Coach your own phone</Title>
      <CharacterSays prefs={character} size={110} text="Hi, I'm Mello. Small steps, big journeys. I'll help you scroll less and do more of what you care about." />
      <Field label="What should I call you?" value={name} onChangeText={setName} placeholder="Your first name" autoComplete="given-name" />
      <Card>
        <Label>What stays private</Label>
        <Muted>
          Mello never reads your screen, messages or notifications. It counts minutes and opens per app on this phone, and sends only daily totals to
          your account so your companion can talk about them. You can delete that history any time.
        </Muted>
      </Card>
      <Muted>If you're also a parent here, this phone switches to your personal mode. Family controls stay on your other phones, and come back here when you sign out of personal mode.</Muted>
      <ErrorText error={error} />
      <Button title="Let's start" busy={busy} disabled={!name.trim()} onPress={finish} />
      <Button title="Not now" variant="secondary" onPress={() => setIntent(null)} />
    </Screen>
  );
}
