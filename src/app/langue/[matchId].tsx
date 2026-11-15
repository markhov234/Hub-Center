import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Notice, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useMatch, type Player } from '@/hooks/use-match';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

const RIGHT = '#2E9E5B';
const WRONG = '#D64545';

export default function MatchScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const { match, players, round, verdict, secondsLeft, submitting, error, answer } = useMatch(matchId);
  const { session } = useSession();
  const theme = useTheme();
  const router = useRouter();

  if (error) {
    return (
      <Screen>
        <Notice>{error}</Notice>
      </Screen>
    );
  }
  if (!match) {
    return (
      <Screen>
        <ActivityIndicator accessibilityLabel="Loading match" />
      </Screen>
    );
  }

  if (match.status === 'lobby') {
    return (
      <Screen>
        <ThemedText themeColor="textSecondary">Read this code to your partner</ThemedText>
        <ThemedText type="title" selectable accessibilityLabel={`Match code ${match.code.split('').join(' ')}`} style={styles.code}>
          {match.code}
        </ThemedText>
        <ActivityIndicator />
        <ThemedText themeColor="textSecondary">Waiting for them to join…</ThemedText>
      </Screen>
    );
  }

  const scoreboard = <Scoreboard players={players} me={session?.user.id} />;

  if (match.status === 'done') {
    const best = Math.max(...players.map((p) => p.score));
    const winners = players.filter((p) => p.score === best);
    return (
      <Screen>
        <ThemedText type="subtitle">
          {winners.length > 1 ? 'A tie!' : `${winners[0]?.profiles?.display_name ?? 'Someone'} wins`}
        </ThemedText>
        {scoreboard}
        <Button label="Back to the hub" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText themeColor="textSecondary">
          Round {match.round_index} / {match.round_count}
        </ThemedText>
        <ThemedText accessibilityLabel={`${secondsLeft} seconds left`}>{secondsLeft}s</ThemedText>
      </View>
      {scoreboard}

      {!round ? (
        <ActivityIndicator accessibilityLabel="Loading round" />
      ) : (
        <>
          <ThemedText themeColor="textSecondary">
            {round.direction === 'fr_to_ko' ? 'In Korean?' : 'En français ?'}
          </ThemedText>
          <ThemedText type="title" style={styles.prompt}>
            {round.prompt}
          </ThemedText>

          {round.choices.map((choice, i) => {
            // Colour is never the only signal: the mark is in the label too.
            const right = verdict?.answer === i;
            const wrongPick = verdict?.choice === i && !right;
            const mark = right ? '✓ ' : wrongPick ? '✗ ' : '';
            return (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityLabel={`${right ? 'Correct: ' : wrongPick ? 'Wrong: ' : ''}${choice}`}
                disabled={!!verdict || submitting}
                onPress={() => answer(i)}
                style={({ pressed }) => [
                  styles.choice,
                  {
                    backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
                    borderColor: right ? RIGHT : wrongPick ? WRONG : 'transparent',
                  },
                ]}>
                <ThemedText style={styles.choiceText}>
                  {mark}
                  {choice}
                </ThemedText>
              </Pressable>
            );
          })}

          {verdict && (
            <Notice>{verdict.choice === verdict.answer ? 'Correct!' : 'Not quite.'} Waiting for the next round…</Notice>
          )}
        </>
      )}
    </Screen>
  );
}

function Scoreboard({ players, me }: { players: Player[]; me?: string }) {
  return (
    <View style={styles.header}>
      {players.map((p) => (
        <ThemedText key={p.user_id} type={p.user_id === me ? 'smallBold' : 'small'}>
          {p.profiles?.display_name ?? '…'} {p.score}
        </ThemedText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three },
  code: { letterSpacing: 8, textAlign: 'center' },
  prompt: { textAlign: 'center', marginVertical: Spacing.four },
  choice: {
    minHeight: 56,
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
  },
  choiceText: { fontSize: 20, lineHeight: 28 },
});
