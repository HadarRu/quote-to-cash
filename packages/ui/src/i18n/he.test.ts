import { describe, expect, it } from 'vitest';
import { errorMessage, format } from './he.ts';

describe('format', () => {
  it('fills placeholders and leaves unknown ones untouched', () => {
    expect(format('שלום, {name} {x}', { name: 'דנה' })).toBe('שלום, דנה {x}');
  });
});

describe('errorMessage', () => {
  it('returns the Hebrew message for a known key with values', () => {
    expect(errorMessage('cooldown', { seconds: 42 })).toBe('אפשר לשלוח קוד חדש בעוד 42 שניות');
  });

  it('falls back to the generic message for unknown keys', () => {
    expect(errorMessage('no_such_key')).toBe('משהו השתבש. נסו שוב.');
  });
});
