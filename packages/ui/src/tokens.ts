/** Design tokens shared by mobile (React Native) and web (CSS variables). Values are in px. */

export type ColorScheme = 'light' | 'dark';

export const palette = {
  primary: '#0F6B5C',
  accent: '#F59E0B',
} as const;

export interface ThemeColors {
  primary: string;
  onPrimary: string;
  accent: string;
  onAccent: string;
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  danger: string;
  success: string;
}

export const colors: Record<ColorScheme, ThemeColors> = {
  light: {
    primary: palette.primary,
    onPrimary: '#FFFFFF',
    accent: palette.accent,
    onAccent: '#1F1300',
    background: '#F7F8F7',
    surface: '#FFFFFF',
    text: '#111827',
    textMuted: '#4B5563',
    border: '#E5E7EB',
    danger: '#B91C1C',
    success: '#15803D',
  },
  dark: {
    primary: '#2BA58F',
    onPrimary: '#04201B',
    accent: palette.accent,
    onAccent: '#1F1300',
    background: '#0B1211',
    surface: '#15201E',
    text: '#F3F4F6',
    textMuted: '#9CA3AF',
    border: '#27322F',
    danger: '#F87171',
    success: '#4ADE80',
  },
};

/** 8px spacing grid: space(2) === 16. */
export const SPACING_UNIT = 8;
export const space = (steps: number): number => steps * SPACING_UNIT;

export const radius = { md: 12, full: 9999 } as const;

/** Minimum touch target for any tappable element. */
export const MIN_TOUCH_TARGET = 48;

export const typography = {
  /** Font family names registered on native (see apps/mobile font loading). */
  nativeFamily: {
    regular: 'Heebo-Regular',
    medium: 'Heebo-Medium',
    bold: 'Heebo-Bold',
  },
  /** CSS font stack for web. */
  webFamily: "'Heebo Variable', 'Heebo', system-ui, sans-serif",
  size: { sm: 14, md: 16, lg: 20, xl: 28 },
  lineHeight: { sm: 20, md: 24, lg: 28, xl: 36 },
} as const;
