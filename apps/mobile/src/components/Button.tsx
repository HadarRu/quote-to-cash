import { MIN_TOUCH_TARGET, radius, space } from '@q2c/ui';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useThemeColors } from '../theme';
import { AppText } from './AppText';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  testID,
}: ButtonProps) {
  const colors = useThemeColors();
  const inactive = disabled || loading;
  const background = {
    primary: colors.primary,
    secondary: colors.surface,
    ghost: 'transparent',
    danger: colors.danger,
  }[variant];
  const foreground = {
    primary: colors.onPrimary,
    secondary: colors.primary,
    ghost: colors.primary,
    danger: colors.onPrimary,
  }[variant];

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: background, opacity: inactive ? 0.55 : pressed ? 0.85 : 1 },
        variant === 'secondary' && { borderWidth: 1, borderColor: colors.primary },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <AppText variant="heading" style={[styles.label, { color: foreground }]}>
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: space(3),
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 16, lineHeight: 24, textAlign: 'center' },
});
