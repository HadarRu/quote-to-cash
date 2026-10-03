import { QUOTE_TOKEN_PATTERN } from '@q2c/types';
import type { NextRequest } from 'next/server';
import { renderPdf } from '../../../../src/pdf/render';

// Headless Chromium needs Node (not the Edge runtime) and is never cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

/**
 * GET /quote/<token>/pdf: prints the customer's page (?print=1) to PDF, so the
 * PDF is exactly what the customer sees, approval details included.
 */
export async function GET(req: NextRequest, ctx: RouteContext<'/quote/[token]/pdf'>) {
  const { token } = await ctx.params;
  const notFound = () =>
    new Response('Not found', {
      status: 404,
      headers: { ...headers, 'Content-Type': 'text/plain' },
    });
  if (!QUOTE_TOKEN_PATTERN.test(token)) return notFound();

  const origin = process.env.PDF_RENDER_ORIGIN || new URL(req.url).origin;
  let rendered;
  try {
    rendered = await renderPdf({ url: `${origin}/quote/${encodeURIComponent(token)}?print=1` });
  } catch (error) {
    console.error('quote pdf failed', error);
    return new Response('PDF failed', {
      status: 500,
      headers: { ...headers, 'Content-Type': 'text/plain' },
    });
  }
  if (!rendered) return notFound();

  const name = rendered.quoteNumber ? `quote-${rendered.quoteNumber}.pdf` : 'quote.pdf';
  return new Response(Buffer.from(rendered.pdf), {
    headers: {
      ...headers,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  });
}
