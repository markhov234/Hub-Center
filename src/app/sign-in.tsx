import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, Field, Notice, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

export default function SignIn() {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setNotice(null);
    const credentials = { email: email.trim(), password };
    const { data, error } = creating
      ? await supabase.auth.signUp({ ...credentials, options: { data: { display_name: name.trim() } } })
      : await supabase.auth.signInWithPassword(credentials);
    setBusy(false);

    if (error) setNotice(error.message);
    // Sign-up with email confirmation switched on returns a user but no session.
    else if (!data.session) setNotice('Check your inbox to confirm your email, then sign in.');
    // On success there is nothing to do: the session change flips the guards in _layout.
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Screen>
        <View style={{ gap: Spacing.one, marginTop: Spacing.six }}>
          <ThemedText type="subtitle">Hub</ThemedText>
          <ThemedText themeColor="textSecondary">
            {creating ? 'Create your account' : 'Sign in to continue'}
          </ThemedText>
        </View>

        {creating && (
          <Field label="Name" value={name} onChangeText={setName} autoComplete="name" maxLength={40} />
        )}
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={creating ? 'new-password' : 'current-password'}
          onSubmitEditing={submit}
        />

        {notice && <Notice>{notice}</Notice>}

        <Button
          label={creating ? 'Create account' : 'Sign in'}
          onPress={submit}
          busy={busy}
          disabled={!email.trim() || !password || (creating && !name.trim())}
        />
        <Button
          tone="quiet"
          label={creating ? 'I already have an account' : 'Create an account'}
          onPress={() => {
            setCreating(!creating);
            setNotice(null);
          }}
        />
      </Screen>
    </SafeAreaView>
  );
}
