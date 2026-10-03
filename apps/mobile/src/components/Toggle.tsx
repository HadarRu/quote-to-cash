import { MIN_TOUCH_TARGET, radius, space } from '@q2c/ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { useThemeColors } from '../theme';
import { AppText } from './AppText';

interface ToggleProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  testID?: string;
}

/** Checkbox row with a 48px touch target. */
export function Toggle({ label, value, onChange, testID }: ToggleProps) {
  const colors = useThemeColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => onChange(!value)}
      style={styles.row}
    >
      <View
        style={[
          styles.box,
          {
            borderColor: value ? colors.primary : colors.border,
            backgroundColor: value ? colors.primary : colors.surface,
          },
        ]}
      >
        {value ? <View style={[styles.tick, { backgroundColor: colors.onPrimary }]} /> : null}
      </View>
      <AppText style={styles.label}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.md / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: { width: 10, height: 10, borderRadius: 2 },
  label: { flex: 1 },
});
