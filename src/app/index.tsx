import { Link, type Href } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

// The whole "app center": adding an app is adding a route and a line here.
const apps: { href: Href; title: string; blurb: string }[] = [
  { href: '/langue', title: 'Langue · 언어', blurb: 'French ↔ Korean, head to head' },
  { href: '/admin/words', title: 'Words', blurb: 'Generate decks and review new words' },
];

export default function Hub() {
  const theme = useTheme();
  return (
    <Screen>
      {apps.map((app) => (
        <Link key={app.title} href={app.href} asChild>
          <Pressable
            accessibilityRole="link"
            style={({ pressed }) => [
              styles.card,
              { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
            ]}>
            <ThemedText type="subtitle">{app.title}</ThemedText>
            <ThemedText themeColor="textSecondary">{app.blurb}</ThemedText>
          </Pressable>
        </Link>
      ))}
      <Button tone="quiet" label="Sign out" onPress={() => supabase.auth.signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.four, borderRadius: 16, gap: Spacing.one },
});
