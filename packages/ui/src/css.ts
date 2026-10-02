import {
  colors,
  MIN_TOUCH_TARGET,
  radius,
  SPACING_UNIT,
  typography,
  type ThemeColors,
} from './tokens';

const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const colorVars = (theme: ThemeColors): string =>
  Object.entries(theme)
    .map(([name, value]) => `--color-${kebab(name)}:${value};`)
    .join('');

/** CSS custom properties for the web app; dark values follow `prefers-color-scheme`. */
export function themeCss(): string {
  const shared =
    `--space:${SPACING_UNIT}px;--radius:${radius.md}px;` +
    `--touch-target:${MIN_TOUCH_TARGET}px;--font-family:${typography.webFamily};`;
  return (
    `:root{${shared}${colorVars(colors.light)}color-scheme:light dark;}` +
    `@media (prefers-color-scheme: dark){:root{${colorVars(colors.dark)}}}`
  );
}
