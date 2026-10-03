import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { themeCss } from '@q2c/ui';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { sampleSnapshot } from '../public-quote/fixtures';
import { QuoteDocument } from '../public-quote/QuoteDocument';
import { renderPdf } from './render';

const require = createRequire(import.meta.url);
const font = (file: string) =>
  readFileSync(require.resolve(`@fontsource-variable/heebo/files/${file}`)).toString('base64');

/** The quote document with the app's CSS and the Heebo font inlined (no server needed). */
function documentHtml(): string {
  const body = renderToStaticMarkup(
    createElement(QuoteDocument, {
      quote: sampleSnapshot(),
      logoUrl: null,
      photoUrls: [],
      approval: { name: 'דנה לוי', at: '2026-10-03T10:00:00Z' },
      rejection: null,
    }),
  );
  const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');
  const faces = ['heebo-hebrew-wght-normal.woff2', 'heebo-latin-wght-normal.woff2']
    .map(
      (f) =>
        `@font-face{font-family:'Heebo Variable';font-weight:100 900;src:url(data:font/woff2;base64,${font(f)}) format('woff2');}`,
    )
    .join('');
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>${faces}${themeCss()}${css}</style></head><body><main class="container">${body}</main></body></html>`;
}

const HEBREW = /[\u0590-\u05FF]/;
const isLtr = (text: string) => !HEBREW.test(text) && /[A-Za-z0-9@]/.test(text);

/**
 * The PDF's text in reading order. Chromium writes one item per word with its
 * position; a line is read right to left, except runs of Latin text and
 * numbers, which read left to right. A wrongly laid-out line reads wrong here.
 */
async function pdfLines(pdf: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data: pdf.slice(), useSystemFonts: false }).promise;
  const lines: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    const rows = new Map<number, { x: number; end: number; str: string }[]>();
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 2);
      const x = item.transform[4];
      rows.set(y, [...(rows.get(y) ?? []), { x, end: x + item.width, str: item.str.trim() }]);
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      const words = rows.get(y)!.sort((a, b) => b.x - a.x);
      // A wide gap is a table cell boundary: a Latin run never continues across it.
      const adjacent = (right: (typeof words)[number], left: (typeof words)[number]) =>
        right.x - left.end < 12;
      const ordered: string[] = [];
      for (let i = 0; i < words.length;) {
        let j = i;
        while (
          j < words.length &&
          isLtr(words[j]!.str) &&
          (j === i || adjacent(words[j - 1]!, words[j]!))
        )
          j++;
        if (j > i) {
          ordered.push(
            ...words
              .slice(i, j)
              .reverse()
              .map((w) => w.str),
          );
          i = j;
        } else ordered.push(words[i++]!.str);
      }
      lines.push(ordered.join(' '));
    }
  }
  return lines;
}

/** Names of the fonts the first page draws with. */
async function pdfFonts(pdf: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data: pdf.slice(), useSystemFonts: false }).promise;
  const page = await doc.getPage(1);
  const ops = await page.getOperatorList();
  const names = new Set<string>();
  ops.fnArray.forEach((fn, i) => {
    if (fn !== OPS.setFont) return;
    const font = page.commonObjs.get(ops.argsArray[i][0] as string) as { name?: string } | null;
    if (font?.name) names.add(font.name);
  });
  return [...names];
}

describe('quote PDF', () => {
  it('prints Hebrew and mixed Hebrew/English text that can be read back', async () => {
    const rendered = await renderPdf({ html: documentHtml() });
    const pdf = rendered!.pdf;
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-');

    const lines = await pdfLines(pdf);
    const text = lines.join('\n');
    for (const expected of [
      'כהן חשמל',
      'הצעת מחיר מספר 12',
      'דנה לוי',
      'החלפת מפסק פחת Hager 40A', // Hebrew with English and numbers in one line
      'office@cohen-electric.co.il',
      'סה״כ לתשלום',
      '796.50',
      'אושרה על ידי דנה לוי',
    ])
      expect(text).toContain(expected);
    // Real glyphs, not boxes: the text is set in the embedded Heebo font.
    expect(await pdfFonts(pdf)).toContainEqual(expect.stringMatching(/Heebo/));
  });
});
