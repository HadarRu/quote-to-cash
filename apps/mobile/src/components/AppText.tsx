import { typography } from '@q2c/ui';
import { StyleSheet, Text, type TextProps } from 'react-native';
import { useThemeColors } from '../theme';

type Variant = 'body' | 'muted' | 'title' | 'heading';

/** Text with the Heebo font and theme colour. Alignment follows the (forced RTL) layout direction. */
export function AppText({ variant = 'body', style, ...props }: TextProps & { variant?: Variant }) {
  const colors = useThemeColors();
  return (
    <Text
      {...props}
      style={[
        styles.base,
        styles[variant],
        {
          color:
            variant === 'muted'
              ? colors.textMuted
              : variant === 'title'
                ? colors.primary
                : colors.text,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    fontFamily: typography.nativeFamily.regular,
    fontSize: typography.size.md,
    lineHeight: typography.lineHeight.md,
  },
  body: {},
  muted: {},
  title: {
    fontFamily: typography.nativeFamily.bold,
    fontSize: typography.size.xl,
    lineHeight: typography.lineHeight.xl,
  },
  heading: {
    fontFamily: typography.nativeFamily.medium,
    fontSize: typography.size.lg,
    lineHeight: typography.lineHeight.lg,
  },
});
