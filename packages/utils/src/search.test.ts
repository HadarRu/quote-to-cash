import { describe, expect, it } from 'vitest';
import { searchText, textMatches } from './search.ts';

describe('searchText', () => {
  it('drops niqqud, unifies final letters and quotes', () => {
    expect(searchText('  שָׁלוֹם   עולם ')).toBe('שלומ עולמ');
    expect(searchText('מאמ״ת')).toBe(searchText('מאמ"ת'));
  });
});

describe('textMatches', () => {
  it('matches partial Hebrew words in any order', () => {
    expect(textMatches('התקנת שקע כוח 16A', 'שקע')).toBe(true);
    expect(textMatches('התקנת שקע כוח 16A', 'כוח שקע')).toBe(true);
    expect(textMatches('התקנת שקע כוח 16A', '16a')).toBe(true);
  });

  it('matches across final and regular letter forms', () => {
    expect(textMatches('שקעים', 'שקעימ')).toBe(true);
    expect(textMatches('מאוורר תקרה', 'מאורר')).toBe(false);
    expect(textMatches('ספוטים שקועים', 'ספוט')).toBe(true);
  });

  it('ignores niqqud in the query and handles empty queries', () => {
    expect(textMatches('תאורה', 'תְּאוּרָה')).toBe(true);
    expect(textMatches('תאורה', '   ')).toBe(true);
    expect(textMatches('תאורה', 'לוח')).toBe(false);
  });
});
