import { FunctionsHttpError } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Field, Notice, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

type Word = {
  id: string;
  fr: string;
  ko: string;
  ko_romaja: string | null;
  en_gloss: string | null;
  topic: string;
};

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

async function fetchUnverified() {
  return supabase
    .from('words')
    .select('id, fr, ko, ko_romaja, en_gloss, topic')
    .eq('verified', false)
    .order('created_at');
}

export default function Words() {
  const theme = useTheme();
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('beginner');
  const [count, setCount] = useState('20');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [unverified, setUnverified] = useState<Word[] | null>(null);

  useEffect(() => {
    fetchUnverified().then(({ data, error }) => (error ? setNotice(error.message) : setUnverified(data)));
  }, []);

  const wanted = Number(count);
  const valid = topic.trim().length >= 2 && Number.isInteger(wanted) && wanted >= 4 && wanted <= 50;

  async function generate() {
    setBusy(true);
    setNotice(null);
    const { data, error } = await supabase.functions.invoke('generate-deck', {
      body: { topic, level, count: wanted },
    });
    if (error) {
      // The function's own explanation is in the response body, not in error.message.
      const body = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
      setBusy(false);
      return setNotice(body?.error ?? error.message);
    }
    const refreshed = await fetchUnverified();
    setBusy(false);
    if (refreshed.data) setUnverified(refreshed.data);
    setTopic('');
    setNotice(`${data.words} words generated. They can't be played until you review them below.`);
  }

  async function review(word: Word, keep: boolean) {
    const table = supabase.from('words');
    const { error } = keep
      ? await table.update({ verified: true }).eq('id', word.id)
      : await table.delete().eq('id', word.id);
    if (error) return setNotice(error.message);
    setUnverified((list) => list?.filter((w) => w.id !== word.id) ?? null);
  }

  return (
    <Screen>
      <ThemedText type="smallBold">Generate a deck</ThemedText>
      <Field label="Topic" value={topic} onChangeText={setTopic} placeholder="food, travel, feelings…" maxLength={60} />
      <View style={styles.row}>
        {LEVELS.map((option) => (
          <View key={option} style={styles.grow}>
            <Button
              label={option}
              accessibilityLabel={`Level: ${option}${option === level ? ', selected' : ''}`}
              tone={option === level ? 'primary' : 'quiet'}
              onPress={() => setLevel(option)}
            />
          </View>
        ))}
      </View>
      <Field label="How many words (4–50)" value={count} onChangeText={setCount} keyboardType="number-pad" maxLength={2} />
      <Button label="Generate" onPress={generate} busy={busy} disabled={!valid} />

      {notice && <Notice>{notice}</Notice>}

      <ThemedText type="smallBold">To review{unverified ? ` (${unverified.length})` : ''}</ThemedText>
      {unverified?.length === 0 && <Notice>Nothing waiting. Every word in the game has been checked.</Notice>}
      {unverified?.map((word) => (
        <View key={word.id} style={[styles.word, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText style={styles.pair}>
            {word.fr} · {word.ko}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {[word.ko_romaja, word.en_gloss, word.topic].filter(Boolean).join(' · ')}
          </ThemedText>
          <View style={styles.row}>
            <View style={styles.grow}>
              <Button label="Keep" accessibilityLabel={`Keep ${word.fr}`} onPress={() => review(word, true)} />
            </View>
            <View style={styles.grow}>
              <Button
                tone="quiet"
                label="Delete"
                accessibilityLabel={`Delete ${word.fr}`}
                onPress={() => review(word, false)}
              />
            </View>
          </View>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two },
  grow: { flex: 1 },
  word: { padding: Spacing.three, borderRadius: 12, gap: Spacing.two },
  pair: { fontSize: 20, lineHeight: 28 },
});
