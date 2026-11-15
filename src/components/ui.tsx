import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Screen({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.screen}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

type ButtonProps = {
  label: string;
  /** Read by screen readers instead of `label` when the label alone is ambiguous. */
  accessibilityLabel?: string;
  onPress: () => void;
  tone?: 'primary' | 'quiet';
  disabled?: boolean;
  busy?: boolean;
};

export function Button({ label, accessibilityLabel, onPress, tone = 'primary', disabled, busy }: ButtonProps) {
  const theme = useTheme();
  const primary = tone === 'primary';
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: primary ? theme.text : theme.backgroundElement },
        off ? styles.off : pressed && styles.pressed,
      ]}>
      {busy ? (
        <ActivityIndicator color={primary ? theme.background : theme.text} />
      ) : (
        <ThemedText themeColor={primary ? 'background' : 'text'}>{label}</ThemedText>
      )}
    </Pressable>
  );
}

export function Field({ label, style, ...props }: TextInputProps & { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }, style]}
        {...props}
      />
    </View>
  );
}

/** Errors and notices. `alert` makes screen readers announce it when it appears. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <ThemedText accessibilityRole="alert" type="small" themeColor="textSecondary">
      {children}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  screen: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  button: {
    minHeight: 48,
    paddingHorizontal: Spacing.four,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
  off: { opacity: 0.5 },
  field: { gap: Spacing.one },
  input: {
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
    fontSize: 16,
  },
});
