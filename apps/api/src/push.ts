// Expo's push service fans out to FCM (Android) and APNs (iOS) from one API, so the backend
// needs no Firebase or Apple keys of its own. Docs: https://docs.expo.dev/push-notifications/sending-notifications/
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export type PushKind = 'rules-changed' | 'new-message' | 'book-assigned';

export async function sendPush(pushToken: string | null, kind: PushKind, body?: { title: string; body: string }) {
  if (!pushToken) return;
  const payload = {
    to: pushToken,
    data: { kind },
    priority: 'high',
    // Data-only pushes wake the app to re-sync; visible ones are for things the kid should notice.
    ...(body ? { title: body.title, body: body.body, sound: 'default' } : { _contentAvailable: true }),
  };
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.warn(`[push] ${res.status} ${await res.text()}`);
  } catch (err) {
    // Push is best-effort: the phone also re-syncs whenever it comes to the foreground.
    console.warn('[push] failed', err);
  }
}
