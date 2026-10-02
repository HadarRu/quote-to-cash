import { colors, type ThemeColors } from '@q2c/ui';
import { useColorScheme } from 'react-native';

export function useThemeColors(): ThemeColors {
  return colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
