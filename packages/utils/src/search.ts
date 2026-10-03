const NIQQUD_AND_CANTILLATION = /[֑-ׇ]/g;
const FINAL_LETTERS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };

/**
 * Normalizes text for search: lower case, no niqqud, final letters as regular
 * letters (so "שקע" matches "שקעים" and "מאמ״ת" matches "מאמ"ת"), Hebrew
 * geresh/gershayim and quotes removed, single spaces.
 */
export function searchText(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(NIQQUD_AND_CANTILLATION, '')
    .replace(/[ךםןףץ]/g, (c) => FINAL_LETTERS[c] ?? c)
    .replace(/["'`״׳]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when every word of the query appears in the text (any order, partial words allowed). */
export function textMatches(text: string, query: string): boolean {
  const q = searchText(query);
  if (!q) return true;
  const haystack = searchText(text);
  return q.split(' ').every((word) => haystack.includes(word));
}
