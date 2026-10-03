import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

/** Chromium binaries tried when CHROMIUM_EXECUTABLE_PATH is not set. */
const CANDIDATES = [
  '/opt/pw-browsers/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
];

export function chromiumPath(): string | null {
  const configured = process.env.CHROMIUM_EXECUTABLE_PATH;
  if (configured) return configured;
  return CANDIDATES.find((path) => existsSync(path)) ?? null;
}

const PDF_OPTIONS = {
  format: 'A4',
  printBackground: true,
  margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
} as const;

export type RenderedPdf = { pdf: Uint8Array; quoteNumber: string | null };

/**
 * Prints a page to PDF with headless Chromium, after its data and fonts have
 * loaded. A URL must reach a ready quote (`[data-ready]`); a state message
 * (not found, expired, ...) prints nothing and returns null.
 */
export async function renderPdf(
  source: { url: string } | { html: string },
): Promise<RenderedPdf | null> {
  const executablePath = chromiumPath();
  if (!executablePath) throw new Error('Chromium not found: set CHROMIUM_EXECUTABLE_PATH');
  const browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--font-render-hinting=none'],
  });
  try {
    const page = await browser.newPage({ locale: 'he-IL', colorScheme: 'light' });
    if ('url' in source) {
      await page.goto(source.url, { waitUntil: 'domcontentloaded' });
      const first = await page.waitForSelector(
        '[data-ready="true"], [data-testid="quote-message"]:not([aria-busy="true"])',
        {
          timeout: 20_000,
        },
      );
      if ((await first.getAttribute('data-ready')) !== 'true') return null;
      // Signed image URLs: wait until they are drawn.
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    } else {
      await page.setContent(source.html, { waitUntil: 'load' });
    }
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const quoteNumber = await page
      .locator('[data-quote-number]')
      .first()
      .getAttribute('data-quote-number', { timeout: 1000 })
      .catch(() => null);
    return { pdf: new Uint8Array(await page.pdf(PDF_OPTIONS)), quoteNumber };
  } finally {
    await browser.close();
  }
}
