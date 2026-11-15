import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Field, Notice, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

type Deck = { id: string; name: string; topic: string; level: string };

export default function Langue() {
  const theme = useTheme();
  const router = useRouter();
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('decks')
      .select('id, name, topic, level')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setNotice(error.message);
        else setDecks(data);
      });
  }, []);

  // Both paths end the same way: the RPC hands back the match row and we go to it.
  async function enter(rpc: 'create_match' | 'join_match', args: Record<string, string>) {
    setBusy(true);
    setNotice(null);
    const { data, error } = await supabase.rpc(rpc, args);
    setBusy(false);
    if (error) return setNotice(error.message);
    router.push({ pathname: '/langue/[matchId]', params: { matchId: data.id } });
  }

  return (
    <Screen>
      <ThemedText type="smallBold">Join with a code</ThemedText>
      <View style={styles.joinRow}>
        <Field
          label="Match code"
          value={code}
          onChangeText={(text) => setCode(text.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          style={styles.code}
        />
        <Button
          label="Join"
          busy={busy}
          disabled={code.trim().length !== 6}
          onPress={() => enter('join_match', { p_code: code })}
        />
      </View>

      {notice && <Notice>{notice}</Notice>}

      <ThemedText type="smallBold">Or start a match</ThemedText>
      {decks?.length === 0 && (
        <Notice>No decks yet. Run supabase/seed.sql, or generate one from Words.</Notice>
      )}
      {decks?.map((deck) => (
        <Pressable
          key={deck.id}
          accessibilityRole="button"
          accessibilityLabel={`Start a match with ${deck.name}`}
          disabled={busy}
          onPress={() => enter('create_match', { p_deck_id: deck.id })}
          style={({ pressed }) => [
            styles.deck,
            { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
          ]}>
          <ThemedText>{deck.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {deck.topic} · {deck.level}
          </ThemedText>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  joinRow: { gap: Spacing.two },
  code: { fontSize: 24, letterSpacing: 6, textAlign: 'center' },
  deck: { padding: Spacing.three, borderRadius: 12, gap: Spacing.half },
});
