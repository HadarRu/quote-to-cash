// The customer quote page with the public-quote Edge Function stubbed: every
// page state, client-side validation, the answer flows, and XSS rendering.
import type { PublicQuoteView, QuoteSnapshot } from '@q2c/types';
import { format, strings } from '@q2c/ui';
import { formatMoney } from '@q2c/utils';
import { expect, test, type Page, type Route } from '@playwright/test';
import { sampleSnapshot } from '../../apps/web/src/public-quote/fixtures.ts';

const t = strings.publicQuote;
const TOKEN = 'T'.repeat(43);
const API = '**/functions/v1/public-quote/**';

function openView(overrides: Partial<QuoteSnapshot> = {}): PublicQuoteView {
  return {
    state: 'open',
    quote: sampleSnapshot(overrides),
    expiresAt: '2026-10-17T20:59:59Z',
    approval: null,
    rejection: null,
    logoUrl: null,
    photoUrls: [],
    slots: [],
    appointment: null,
  };
}

type Handler = (route: Route, action: string | undefined, body: unknown) => Promise<void> | void;

/** Stubs the Edge Function; records what the page sent. */
async function stub(page: Page, handler: Handler) {
  const calls: { action: string | undefined; body: unknown }[] = [];
  await page.route(API, async (route) => {
    const url = new URL(route.request().url());
    const action = url.pathname.split('/public-quote/')[1]!.split('/')[1];
    const body = route.request().postDataJSON() as unknown;
    calls.push({ action, body });
    await handler(route, action, body);
  });
  return calls;
}

const reply = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Fails the test if anything on the page opens an alert/confirm/prompt. */
function noDialogs(page: Page) {
  page.on('dialog', (dialog) => {
    throw new Error(`unexpected dialog: ${dialog.message()}`);
  });
}

test.beforeEach(({ page }) => noDialogs(page));

test('shows the open quote in Hebrew, right to left, with server totals', async ({ page }) => {
  const calls = await stub(page, (route) => reply(route, 200, openView()));
  await page.goto(`/quote/${TOKEN}`);
  await expect(page.getByTestId('quote-title')).toHaveText(format(t.titleNumber, { number: 12 }));
  await expect(page.locator('.quote-subject')).toHaveText('החלפת לוח חשמל');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.getByTestId('quote-item')).toHaveCount(2);
  await expect(page.getByTestId('quote-total')).toHaveText(formatMoney(79650));
  await expect(page.getByTestId('quote-answer')).toBeVisible();
  expect(calls).toEqual([{ action: undefined, body: null }]);
});

test('protects the token: no-referrer, noindex, no framing, no caching', async ({ page }) => {
  await stub(page, (route) => reply(route, 200, openView()));
  const response = await page.goto(`/quote/${TOKEN}`);
  const headers = response!.headers();
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['x-robots-tag']).toBe('noindex, nofollow');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['cache-control']).toBe('no-store');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('unknown link: not-found message, no retry', async ({ page }) => {
  await stub(page, (route) => reply(route, 404, { error: 'not_found' }));
  await page.goto(`/quote/${TOKEN}`);
  await expect(page.getByRole('heading', { name: t.notFoundTitle })).toBeVisible();
  await expect(page.getByRole('button', { name: t.retry })).toHaveCount(0);
});

test('rate limited, then retry succeeds', async ({ page }) => {
  let n = 0;
  await stub(page, (route) =>
    n++ === 0 ? reply(route, 429, { error: 'rate_limited' }) : reply(route, 200, openView()),
  );
  await page.goto(`/quote/${TOKEN}`);
  await expect(page.getByRole('heading', { name: t.rateLimitedTitle })).toBeVisible();
  await page.getByRole('button', { name: t.retry }).click();
  await expect(page.getByTestId('quote-title')).toBeVisible();
});

test('network failure shows the error state with retry', async ({ page }) => {
  await stub(page, (route) => route.abort('internetdisconnected'));
  await page.goto(`/quote/${TOKEN}`);
  await expect(page.getByRole('heading', { name: t.errorTitle })).toBeVisible();
  await expect(page.getByRole('button', { name: t.retry })).toBeVisible();
});

for (const [state, title] of [
  ['cancelled', t.cancelledTitle],
  ['superseded', t.supersededTitle],
] as const) {
  test(`${state} quote shows only that`, async ({ page }) => {
    await stub(page, (route) => reply(route, 200, { state, business: { name: 'כהן חשמל' } }));
    await page.goto(`/quote/${TOKEN}`);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByTestId('quote-document')).toHaveCount(0);
  });
}

test('expired quote cannot be answered', async ({ page }) => {
  await stub(page, (route) => reply(route, 200, { ...openView(), state: 'expired' }));
  await page.goto(`/quote/${TOKEN}`);
  await expect(page.getByRole('heading', { name: t.expiredTitle })).toBeVisible();
  await expect(page.getByTestId('quote-answer')).toHaveCount(0);
});

test('approve: validates the name in the browser, then approves', async ({ page }) => {
  const calls = await stub(page, (route, action, body) =>
    action === 'approve'
      ? reply(route, 200, {
          ...openView(),
          state: 'approved',
          approval: { name: (body as { name: string }).name, at: '2026-10-04T10:00:00Z' },
        })
      : reply(route, 200, openView()),
  );
  await page.goto(`/quote/${TOKEN}`);
  await page.getByTestId('approve-submit').click();
  await expect(page.getByTestId('answer-error')).toHaveText(strings.errors.approve_name_required);
  expect(calls.filter((c) => c.action === 'approve')).toEqual([]);

  await page.getByTestId('approve-name').fill('דנה לוי');
  await page.getByTestId('approve-submit').click();
  await expect(page.getByTestId('quote-notice')).toHaveText(
    format(t.approvedNow, { business: 'כהן חשמל' }),
  );
  await expect(page.getByTestId('quote-approval')).toContainText('דנה לוי');
  await expect(page.getByTestId('quote-answer')).toHaveCount(0);
  expect(calls.filter((c) => c.action === 'approve')).toEqual([
    { action: 'approve', body: { name: 'דנה לוי' } },
  ]);
});

test('approve after the business closed the quote: explains and reloads', async ({ page }) => {
  let closed = false;
  await stub(page, (route, action) => {
    if (action === 'approve') {
      closed = true;
      return reply(route, 409, { error: 'quote_closed' });
    }
    return reply(
      route,
      200,
      closed ? { state: 'cancelled', business: { name: 'כהן חשמל' } } : openView(),
    );
  });
  await page.goto(`/quote/${TOKEN}`);
  await page.getByTestId('approve-name').fill('דנה לוי');
  await page.getByTestId('approve-submit').click();
  await expect(page.getByRole('heading', { name: t.cancelledTitle })).toBeVisible();
});

test('server validation errors are shown in Hebrew', async ({ page }) => {
  await stub(page, (route, action) =>
    action === 'approve'
      ? reply(route, 422, { error: 'approve_name_too_long' })
      : reply(route, 200, openView()),
  );
  await page.goto(`/quote/${TOKEN}`);
  await page.getByTestId('approve-name').fill('דנה לוי');
  await page.getByTestId('approve-submit').click();
  await expect(page.getByTestId('answer-error')).toHaveText(strings.errors.approve_name_too_long);
});

test('reject with a reason', async ({ page }) => {
  const calls = await stub(page, (route, action) =>
    action === 'reject'
      ? reply(route, 200, {
          ...openView(),
          state: 'rejected',
          rejection: { reason: 'יקר מדי', at: '2026-10-04T10:00:00Z' },
        })
      : reply(route, 200, openView()),
  );
  await page.goto(`/quote/${TOKEN}`);
  await page.getByTestId('show-reject').click();
  await page.getByTestId('reject-reason').fill('יקר מדי');
  await page.getByTestId('reject-submit').click();
  await expect(page.getByTestId('quote-notice')).toHaveText(t.rejectedNow);
  await expect(page.getByTestId('quote-rejection')).toBeVisible();
  expect(calls.at(-1)).toEqual({ action: 'reject', body: { reason: 'יקר מדי' } });
});

test('comment: empty is refused in the browser; a question is sent', async ({ page }) => {
  const calls = await stub(page, (route, action) =>
    action === 'comment' ? reply(route, 200, { ok: true }) : reply(route, 200, openView()),
  );
  await page.goto(`/quote/${TOKEN}`);
  await page.getByTestId('comment-send').click();
  await expect(page.getByTestId('quote-comment').getByRole('alert')).toHaveText(
    strings.errors.comment_required,
  );
  await page.getByTestId('comment-body').fill('אפשר ביום חמישי?');
  await page.getByTestId('comment-send').click();
  await expect(page.getByTestId('quote-comment').getByRole('status')).toHaveText(t.commentSent);
  await expect(page.getByTestId('comment-body')).toHaveValue('');
  expect(calls.filter((c) => c.action === 'comment')).toEqual([
    { action: 'comment', body: { body: 'אפשר ביום חמישי?' } },
  ]);
});

test.describe('XSS', () => {
  const payload = `<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>`;

  test('owner- and customer-entered text renders as text, never as markup', async ({ page }) => {
    const base = sampleSnapshot();
    await stub(page, (route) =>
      reply(route, 200, {
        ...openView({
          title: payload,
          notes: payload,
          business: { ...base.business, name: payload },
          customer: { ...base.customer, full_name: payload, address: payload },
          items: [{ ...base.items[0]!, description: payload, unit: payload }],
        }),
        state: 'approved',
        approval: { name: payload, at: '2026-10-04T10:00:00Z' },
      }),
    );
    await page.goto(`/quote/${TOKEN}`);
    await expect(page.locator('.quote-subject')).toHaveText(payload);
    await expect(page.getByTestId('quote-item')).toContainText(payload);
    await expect(page.getByTestId('quote-customer')).toHaveText(payload);
    await expect(page.getByTestId('quote-approval')).toContainText(payload);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
    const scripts = await page
      .locator('script')
      .evaluateAll((els) => els.map((e) => e.textContent ?? ''));
    expect(scripts.some((s) => s.includes('__xss'))).toBe(false);
  });

  test('the token in the URL is not reflected as markup', async ({ page }) => {
    await stub(page, (route) => reply(route, 404, { error: 'not_found' }));
    await page.goto(`/quote/${encodeURIComponent('"><img src=x onerror=window.__xss=3>')}`);
    await expect(page.getByRole('heading', { name: t.notFoundTitle })).toBeVisible();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
  });
});
