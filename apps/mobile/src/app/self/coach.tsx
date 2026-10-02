import { useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import { characterOf, displayName, type ClientAction } from '@mello/shared';
import { selfApi, type AgentTurn } from '@/lib/api';
import { cachedConfig, syncKid } from '@/lib/kid';
import { readJson, writeJson } from '@/lib/cache';
import { startFocus } from '@/lib/self';
import { useSelfSession } from '@/lib/session';
import { CharacterArt } from '@/components/Character';
import { Button, colors, ErrorText, Muted } from '@/components/ui';

type Item = AgentTurn & { offers?: Extract<ClientAction, { type: 'start_focus' }>[] };

const EXAMPLES = [
  'How was my phone use this week?',
  'Help me swap Instagram for 20 minutes of reading',
  "I'm into stoicism, what should I read next?",
  'Wind down from 22:30 to 7:00, only Audible allowed',
];

/**
 * Chat with your companion. It can change goals and limits, and offer to start a focus session,
 * which only runs after you tap it. The conversation is kept on this phone only.
 */
export default function Coach() {
  const session = useSelfSession();
  const config = useMemo(() => cachedConfig(), []);
  const prefs = config?.kid.settings.character;
  const accent = characterOf(prefs).colors.accent;
  const [items, setItems] = useState<Item[]>(() => readJson<Item[]>('coach-chat', []));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const list = useRef<FlatList<Item>>(null);

  const save = (next: Item[]) => {
    setItems(next);
    writeJson('coach-chat', next.slice(-40));
  };

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const next: Item[] = [...items, { role: 'user', content: text.trim() }];
    save(next);
    setInput('');
    setBusy(true);
    setError(null);
    try {
      const res = await selfApi().coach(next.map(({ role, content }) => ({ role, content })));
      if (res.clientActions.some((a) => a.type === 'refresh')) await syncKid(session.token).catch(() => {});
      const offers = res.clientActions.filter((a): a is Extract<ClientAction, { type: 'start_focus' }> => a.type === 'start_focus');
      save([...next, { role: 'assistant', content: res.reply, offers }]);
      if (prefs?.voiceOn) {
        const v = characterOf(prefs).voice;
        Speech.speak(res.reply, { pitch: v.pitch, rate: v.rate });
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <FlatList
          ref={list}
          data={items}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          onContentSizeChange={() => list.current?.scrollToEnd()}
          ListHeaderComponent={
            <View style={{ alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <CharacterArt prefs={prefs} mood={busy ? 'sleepy' : 'happy'} size={96} />
              {items.length === 0 && (
                <View style={{ gap: 8, alignSelf: 'stretch' }}>
                  <Muted>Ask {displayName(prefs)} anything about your habits. For example:</Muted>
                  {EXAMPLES.map((e) => (
                    <Button key={e} title={e} variant="secondary" onPress={() => send(e)} />
                  ))}
                </View>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <View
              style={{
                alignSelf: item.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                backgroundColor: item.role === 'user' ? accent : colors.card,
                borderRadius: 14,
                borderWidth: item.role === 'user' ? 0 : 1,
                borderColor: accent,
                padding: 12,
                gap: 8,
              }}
            >
              <Text style={{ color: item.role === 'user' ? '#FFFFFF' : colors.ink, fontSize: 16 }}>{item.content}</Text>
              {item.offers?.map((o, i) => (
                <Button
                  key={i}
                  title={`Start ${o.minutes} min in ${o.label}`}
                  onPress={() => startFocus({ packageName: o.app, label: o.label }, o.minutes)}
                />
              ))}
            </View>
          )}
          ListFooterComponent={
            <View style={{ gap: 6 }}>
              {busy && <Muted>{displayName(prefs)} is thinking…</Muted>}
              <ErrorText error={error} />
              {items.length > 0 && <Button title="Clear chat" variant="secondary" onPress={() => save([])} />}
            </View>
          }
        />
        <View style={{ flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderColor: colors.border }}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={`Talk to ${displayName(prefs)}…`}
            placeholderTextColor={colors.muted}
            onSubmitEditing={() => send(input)}
            style={{ flex: 1, backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 12, fontSize: 16, borderWidth: 1, borderColor: colors.border }}
          />
          <Button title="Send" onPress={() => send(input)} disabled={!input.trim()} busy={busy} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
