// Critical path 1 across the real stack: the business creates a customer and a
// quote and sends it (the same API calls the app makes), the customer opens the
// link in a browser and approves, and the business sees the result.
import { strings } from '@q2c/ui';
import { expect, test } from '@playwright/test';
import {
  adminClient,
  businesses,
  createCustomer,
  createDraft,
  sendQuote,
  signIn,
  users,
} from '../stack.ts';

const t = strings.publicQuote;

test('create customer and quote, send, customer opens and approves', async ({ page }) => {
  const owner = await signIn(users.ownerA.phone);
  const customerId = await createCustomer(owner, businesses.a, { fullName: 'נועה ברק' });
  const sent = await sendQuote(
    owner,
    await createDraft(owner, businesses.a, { customerId, title: 'התקנת מזגן' }),
  );
  expect(sent.url).toMatch(/\/quote\/[A-Za-z0-9_-]{43}$/);

  // The customer opens the link.
  await page.goto(`/quote/${sent.token}`);
  await expect(page.getByTestId('quote-title')).toContainText(String(sent.quoteNumber));
  await expect(page.getByTestId('quote-document')).toContainText('התקנת מזגן');
  await expect(page.getByTestId('quote-customer')).toHaveText('נועה ברק');
  const viewed = await owner.client.from('quote').select('status').eq('id', sent.quoteId).single();
  expect(viewed.data!.status).toBe('viewed');

  // A question, then approval with a typed name.
  await page.getByTestId('comment-body').fill('מתי אפשר להתחיל?');
  await page.getByTestId('comment-send').click();
  await expect(page.getByTestId('quote-comment').getByRole('status')).toHaveText(t.commentSent);
  await page.getByTestId('approve-name').fill('נועה ברק');
  await page.getByTestId('approve-submit').click();
  await expect(page.getByTestId('quote-approval')).toContainText('נועה ברק');

  // The business sees it.
  const { data: quote } = await owner.client
    .from('quote')
    .select('status, approved_name, approved_at')
    .eq('id', sent.quoteId)
    .single();
  expect(quote).toMatchObject({ status: 'approved', approved_name: 'נועה ברק' });
  const { data: comments } = await owner.client
    .from('quote_comment')
    .select('body')
    .eq('quote_id', sent.quoteId);
  expect(comments).toEqual([{ body: 'מתי אפשר להתחיל?' }]);

  // Reloading shows the approved quote with no way to answer again.
  await page.reload();
  await expect(page.getByTestId('quote-approval')).toBeVisible();
  await expect(page.getByTestId('quote-answer')).toHaveCount(0);
});

test('a revised quote: the old link says so, the new one opens', async ({ page }) => {
  const owner = await signIn(users.ownerA.phone);
  const first = await sendQuote(owner, await createDraft(owner, businesses.a));
  const newId = crypto.randomUUID();
  const { error } = await owner.client.rpc('revise_quote', {
    p_quote_id: first.quoteId,
    p_new_quote_id: newId,
  });
  expect(error).toBeNull();
  const second = await sendQuote(owner, { ...first, quoteId: newId });

  await page.goto(`/quote/${first.token}`);
  await expect(page.getByRole('heading', { name: t.supersededTitle })).toBeVisible();
  await page.goto(`/quote/${second.token}`);
  await expect(page.getByTestId('quote-answer')).toBeVisible();
  const { data } = await adminClient().from('quote').select('revision').eq('id', newId).single();
  expect(data!.revision).toBe(2);
});
