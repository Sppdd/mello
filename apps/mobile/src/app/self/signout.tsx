import { useState } from 'react';
import { selfApi } from '@/lib/api';
import { clearKidDevice } from '@/lib/kid';
import { writeJson } from '@/lib/cache';
import { useSession } from '@/lib/session';
import { Button, Card, ErrorText, Label, Muted, Screen } from '@/components/ui';

/** It's your phone: signing out needs no password. Deleting history is separate and immediate. */
export default function SelfSignOut() {
  const { signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <Label>Delete my history</Label>
        <Muted>Removes your daily usage totals, focus sessions and reflections from your account, and the chat on this phone. Goals and limits stay.</Muted>
        <Button
          title={deleted ? 'Deleted' : 'Delete my history'}
          variant="danger"
          busy={busy}
          disabled={deleted}
          onPress={() =>
            run(async () => {
              await selfApi().deleteData();
              writeJson('coach-chat', []);
              writeJson('focus-minutes', {});
              setDeleted(true);
            })
          }
        />
      </Card>
      <Card>
        <Label>Sign out of Mello on this phone</Label>
        <Muted>Your guard, limits and goals stop on this phone. Your streak stops counting until you sign back in.</Muted>
        <Button
          title="Sign out"
          busy={busy}
          onPress={() =>
            run(async () => {
              await selfApi().signOut().catch(() => {});
              clearKidDevice();
              writeJson('coach-chat', []);
              await signOut();
            })
          }
        />
      </Card>
      <ErrorText error={error} />
    </Screen>
  );
}
