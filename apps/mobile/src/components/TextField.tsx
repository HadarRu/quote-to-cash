import { MIN_TOUCH_TARGET, radius, space, typography } from '@q2c/ui';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useThemeColors } from '../theme';
import { AppText } from './AppText';

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | null;
  hint?: string;
}

export function TextField({ label, error, hint, testID, ...inputProps }: TextFieldProps) {
  const colors = useThemeColors();
  return (
    <View style={styles.field}>
      <AppText variant="muted" nativeID={testID ? `${testID}-label` : undefined}>
        {label}
      </AppText>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        {...inputProps}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : colors.border,
          },
        ]}
      />
      {error ? (
        <AppText accessibilityRole="alert" style={{ color: colors.danger }}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="muted">{hint}</AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space(0.5) },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(2),
    fontFamily: typography.nativeFamily.regular,
    fontSize: typography.size.md,
  },
});
