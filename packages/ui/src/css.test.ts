import { describe, expect, it } from 'vitest';
import { themeCss } from './css.ts';

describe('themeCss', () => {
  it('emits brand tokens for light and dark schemes', () => {
    const css = themeCss();
    expect(css).toContain('--color-primary:#0F6B5C;');
    expect(css).toContain('--color-accent:#F59E0B;');
    expect(css).toContain('--radius:12px;');
    expect(css).toContain('--touch-target:48px;');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
  });
});
