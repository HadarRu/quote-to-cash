import { space } from '@q2c/ui';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors } from '../theme';
import { AppText } from './AppText';

interface ScreenProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Pinned under the scrolling content (primary actions). */
  footer?: ReactNode;
}

/** Standard screen: safe area, keyboard-aware scrolling, max width on large screens. */
export function Screen({ title, subtitle, children, footer }: ScreenProps) {
  const colors = useThemeColors();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {title ? (
            <View style={styles.header}>
              <AppText variant="title" accessibilityRole="header">
                {title}
              </AppText>
              {subtitle ? <AppText variant="muted">{subtitle}</AppText> : null}
            </View>
          ) : null}
          {children}
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: space(2), gap: space(3), width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { gap: space(1) },
  footer: { padding: space(2), gap: space(1), width: '100%', maxWidth: 560, alignSelf: 'center' },
});
