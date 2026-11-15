import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SessionProvider, useSession } from '@/lib/session';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <SessionProvider>
      <RootStack />
    </SessionProvider>
  );
}

function RootStack() {
  const { session, loading } = useSession();
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  // Keep the splash up until we know whether there is a stored session, so a signed-in
  // user never sees the sign-in screen flash by.
  if (loading) return null;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="index" options={{ title: 'Hub' }} />
          <Stack.Screen name="langue/index" options={{ title: 'Langue · 언어' }} />
          <Stack.Screen name="langue/[matchId]" options={{ title: 'Match' }} />
          <Stack.Screen name="admin/words" options={{ title: 'Words' }} />
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
