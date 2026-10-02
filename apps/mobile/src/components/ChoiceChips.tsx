import { MIN_TOUCH_TARGET, radius, space } from '@q2c/ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { useThemeColors } from '../theme';
import { AppText } from './AppText';

interface ChoiceChipsProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string | null;
  testID?: string;
}

/** Single-choice group (radio semantics) laid out as wrapping chips. */
export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
  testID,
}: ChoiceChipsProps<T>) {
  const colors = useThemeColors();
  return (
    <View
      style={styles.group}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      testID={testID}
    >
      <AppText variant="muted">{label}</AppText>
      <View style={styles.chips}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              testID={testID ? `${testID}-${option.value}` : undefined}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              onPress={() => onChange(option.value)}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? colors.primary : colors.surface,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
            >
              <AppText style={{ color: selected ? colors.onPrimary : colors.text }}>
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <AppText accessibilityRole="alert" style={{ color: colors.danger }}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space(1) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1) },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: space(2),
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
  },
});
