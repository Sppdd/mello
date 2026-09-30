import { useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { parentApi, type AgentAction, type AgentTurn } from '@/lib/api';
import { useParentSession } from '@/lib/session';
import { Button, colors, ErrorText, Muted } from '@/components/ui';

type Item = AgentTurn & { actions?: AgentAction[] };

const EXAMPLES = ['Make Sara read 5 minutes before TikTok', 'Tell Adam dinner is ready', 'How much did Sara read this week?'];

export default function Agent() {
  const session = useParentSession();
  const api = useMemo(() => parentApi(session.token), [session.token]);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const list = useRef<FlatList<Item>>(null);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const next: Item[] = [...items, { role: 'user', content: text.trim() }];
    setItems(next);
    setInput('');
    setBusy(true);
    setError(null);
    try {
      const res = await api.agent(next.map(({ role, content }) => ({ role, content })));
      setItems([...next, { role: 'assistant', content: res.reply, actions: res.actions }]);
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
            items.length === 0 ? (
              <View style={{ gap: 8 }}>
                <Muted>Tell Mello what you want. For example:</Muted>
                {EXAMPLES.map((e) => (
                  <Button key={e} title={e} variant="secondary" onPress={() => send(e)} />
                ))}
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <View
              style={{
                alignSelf: item.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                backgroundColor: item.role === 'user' ? colors.primary : colors.card,
                borderRadius: 14,
                padding: 12,
                gap: 6,
              }}
            >
              <Text style={{ color: item.role === 'user' ? colors.primaryInk : colors.ink, fontSize: 16 }}>{item.content}</Text>
              {item.actions?.map((a, i) => (
                <Text key={i} style={{ color: a.ok ? colors.good : colors.bad, fontSize: 13 }}>
                  {a.ok ? '✓' : '✗'} {a.summary}
                </Text>
              ))}
            </View>
          )}
          ListFooterComponent={
            <View style={{ gap: 6 }}>
              {busy && <Muted>Mello is thinking…</Muted>}
              <ErrorText error={error} />
            </View>
          }
        />
        <View style={{ flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderColor: colors.border }}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Tell Mello what to do…"
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
