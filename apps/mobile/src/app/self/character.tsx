import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { CharacterPrefs } from '@mello/shared';
import { selfApi } from '@/lib/api';
import { cachedConfig, syncKid } from '@/lib/kid';
import { useSelfSession } from '@/lib/session';
import { CharacterPicker } from '@/components/CharacterPicker';
import { Button, ErrorText, Screen } from '@/components/ui';

export default function CharacterScreen() {
  const session = useSelfSession();
  const initial = useMemo(() => cachedConfig()?.kid.settings.character ?? CharacterPrefs.parse({}), []);
  const [value, setValue] = useState<CharacterPrefs>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await selfApi().updateProfile({ character: value });
      await syncKid(session.token); // the bubble and reminders pick up the new voice
      router.back();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <CharacterPicker value={value} onChange={setValue} />
      <ErrorText error={error} />
      <Button title="Save" busy={busy} onPress={save} />
    </Screen>
  );
}
