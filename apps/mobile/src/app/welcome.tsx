import { useState } from 'react';
import { Redirect } from 'expo-router';
import { publicApi } from '@/lib/api';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Button, Card, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';

export default function Welcome() {
  const { session, signInKid } = useSession();
  const [mode, setMode] = useState<'choose' | 'parent' | 'kid'>('choose');
  const [isNewAccount, setIsNewAccount] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [kidName, setKidName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (session) return <Redirect href="/" />;

  // The root layout moves to the right home screen once the session changes.
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const parentAuth = () =>
    run(async () => {
      const creds = { email: email.trim(), password };
      if (isNewAccount) {
        const { data, error: err } = await supabase.auth.signUp(creds);
        if (err) throw err;
        // With email confirmation on, there's no session until the link in the email is opened.
        if (!data.session) setNotice(`We sent a confirmation link to ${creds.email}. Open it, then sign in here.`);
      } else {
        const { error: err } = await supabase.auth.signInWithPassword(creds);
        if (err) throw err;
      }
    });

  if (mode === 'parent')
    return (
      <Screen>
        <Title>{isNewAccount ? 'Create a parent account' : 'Parent sign in'}</Title>
        <Muted>Your account works on any phone, and you can add a second parent later.</Muted>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Field label="Password (8+ characters)" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="password" />
        <ErrorText error={error} />
        {notice && <Muted>{notice}</Muted>}
        <Button
          title={isNewAccount ? 'Create account' : 'Sign in'}
          busy={busy}
          disabled={!/^\S+@\S+\.\S+$/.test(email.trim()) || password.length < 8}
          onPress={parentAuth}
        />
        <Button
          title={isNewAccount ? 'I already have an account' : 'Create a new account'}
          variant="secondary"
          onPress={() => {
            setIsNewAccount(!isNewAccount);
            setError(null);
            setNotice(null);
          }}
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
              await signInKid({ role: 'kid', token: k.deviceToken, kidId: k.kidId, kidName: kidName.trim() });
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
        <Muted>Parents set reading rules, tasks, time limits and bedtime, and send voice messages.</Muted>
        <Button title="I'm the parent" onPress={() => setMode('parent')} />
      </Card>
      <Card>
        <Muted>Kids read, listen or watch a little before opening the apps their parent picked.</Muted>
        <Button title="This is my kid's phone" variant="secondary" onPress={() => setMode('kid')} />
      </Card>
    </Screen>
  );
}
