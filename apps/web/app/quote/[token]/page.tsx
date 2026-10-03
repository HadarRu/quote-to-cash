import { strings } from '@q2c/ui';
import type { Metadata } from 'next';
import { PublicQuote } from '../../../src/public-quote/PublicQuote';

export const metadata: Metadata = {
  title: strings.publicQuote.title,
  // The URL holds the customer's token: keep it out of search engines and Referer headers.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/** The customer's quote: /quote/<token> (add ?print=1 for the PDF layout). */
export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { token } = await params;
  const { print } = await searchParams;
  return <PublicQuote token={token} print={print === '1'} />;
}
