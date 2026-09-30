import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { Book } from '@mello/shared';
import { parentApi } from '@/lib/api';
import { useParentSession } from '@/lib/session';
import { SAMPLE_BOOK } from '@/lib/sampleBook';
import { Button, Card, ErrorText, Field, Label, Muted, Screen, Title } from '@/components/ui';

export default function Books() {
  const session = useParentSession();
  const api = useMemo(() => parentApi(session.token), [session.token]);
  const [books, setBooks] = useState<Book[]>([]);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [age, setAge] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    api.books().then(setBooks).catch(setError);
  }, [api]);
  useFocusEffect(load);

  const add = async (input: { title: string; author?: string; ageLevel?: number; text: string }) => {
    setBusy(true);
    setError(null);
    try {
      await api.addBook(input);
      setTitle('');
      setAuthor('');
      setAge('');
      setText('');
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Library</Title>
      {books.length === 0 && <Muted>No books yet.</Muted>}
      {books.map((b) => (
        <Card key={b.id}>
          <Label>{b.title}</Label>
          {b.author && <Muted>{b.author}</Muted>}
        </Card>
      ))}
      {!books.some((b) => b.title === SAMPLE_BOOK.title) && (
        <Button
          title={`Add "${SAMPLE_BOOK.title}" (sample)`}
          variant="secondary"
          onPress={() => add({ title: SAMPLE_BOOK.title, author: SAMPLE_BOOK.author ?? undefined, ageLevel: SAMPLE_BOOK.ageLevel ?? undefined, text: SAMPLE_BOOK.text })}
        />
      )}

      <Title>Add a book</Title>
      <Muted>Paste the text of a book or story. Blank lines separate paragraphs.</Muted>
      <Field label="Title" value={title} onChangeText={setTitle} />
      <Field label="Author (optional)" value={author} onChangeText={setAuthor} />
      <Field label="Reader's age (optional)" value={age} onChangeText={(t) => setAge(t.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />
      <Field label="Text" value={text} onChangeText={setText} multiline style={{ minHeight: 160, textAlignVertical: 'top' }} />
      <ErrorText error={error} />
      <Button
        title="Add book"
        busy={busy}
        disabled={!title.trim() || text.trim().length < 200}
        onPress={() => add({ title: title.trim(), author: author.trim() || undefined, ageLevel: age ? Number(age) : undefined, text: text.trim() })}
      />
    </Screen>
  );
}
