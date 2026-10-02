import { space } from '@q2c/ui';
import { StyleSheet, View } from 'react-native';
import { useThemeColors } from '../theme';
import { AppText } from './AppText';
import { Button } from './Button';

interface FullScreenMessageProps {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** Whole-screen error / empty state with an optional action. */
export function FullScreenMessage({ title, body, actionLabel, onAction }: FullScreenMessageProps) {
  const colors = useThemeColors();
  return (
    <View style={[styles.center, { backgroundColor: colors.background }]} accessibilityRole="alert">
      <AppText variant="heading" style={styles.text}>
        {title}
      </AppText>
      {body ? (
        <AppText variant="muted" style={styles.text}>
          {body}
        </AppText>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(2),
    padding: space(3),
  },
  text: { textAlign: 'center' },
});
