import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { CharacterPrefs } from '@mello/shared';
import { kidApi } from '@/lib/api';
import { cachedConfig, syncKid } from '@/lib/kid';
import { useKidSession } from '@/lib/session';
import { CharacterPicker } from '@/components/CharacterPicker';
import { Button, ErrorText, Screen } from '@/components/ui';

/** A kid picks Mello's colour and a nickname. */
export default function Buddy() {
  const session = useKidSession();
  const config = useMemo(() => cachedConfig(), []);
  const [value, setValue] = useState<CharacterPrefs>(() => config?.kid.settings.character ?? CharacterPrefs.parse({}));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await kidApi(session.token).setCharacter(value);
      await syncKid(session.token);
      router.back();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <CharacterPicker value={value} onChange={setValue} showTone={false} />
      <ErrorText error={error} />
      <Button title="Save" busy={busy} onPress={save} />
    </Screen>
  );
}
