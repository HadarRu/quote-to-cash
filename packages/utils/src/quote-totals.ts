/**
 * Quote totals in integer agorot. The app shows these while editing; the
 * `quotes` Edge Function recomputes them from the stored lines when sending,
 * and that result is authoritative.
 *
 * Rules
 * - A line total is quantity × unit price, rounded half away from zero (the
 *   same as Postgres `round(numeric)`, which checks quote_item.line_total_minor).
 * - Quantities may have up to 3 decimals.
 * - Prices may include VAT (per line). The subtotal is the amount before VAT.
 * - The discount is a percent (basis points) or an amount, taken off the
 *   subtotal before VAT; a percent also comes exactly off the gross total.
 * - VAT is the rest of the total, so VAT-inclusive prices keep their exact
 *   gross: one line of ₪100.00 including 18% VAT totals ₪100.00, not ₪100.01.
 * - Always: total = subtotal − discount + VAT.
 */

export type DiscountType = 'none' | 'percent' | 'amount';

export interface QuoteLineInput {
  /** Decimal string ("1.5") or number; up to 3 decimals. */
  quantity: string | number;
  unitPriceMinor: number;
  vatIncluded: boolean;
}

export interface QuoteTotalsInput {
  lines: readonly QuoteLineInput[];
  discountType: DiscountType;
  /** Basis points for 'percent' (1000 = 10%), agorot for 'amount'. */
  discountValue: number;
  /** VAT rate in basis points (1800 = 18%); 0 for VAT-exempt businesses. */
  vatRateBp: number;
}

export interface QuoteTotals {
  lineTotalsMinor: number[];
  subtotalMinor: number;
  discountMinor: number;
  vatRateBp: number;
  vatMinor: number;
  totalMinor: number;
}

const BP = 10000n;

/** a / b rounded half away from zero, for a ≥ 0 and b > 0. */
function divRound(a: bigint, b: bigint): bigint {
  return (2n * a + b) / (2n * b);
}

/** "1.5" -> 1500 (thousandths). Throws on anything that is not a positive decimal with ≤ 3 places. */
export function quantityThousandths(quantity: string | number): bigint {
  const text = typeof quantity === 'number' ? String(quantity) : quantity.trim();
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text);
  if (!match) throw new RangeError(`invalid quantity: ${text}`);
  const thousandths = BigInt(match[1]!) * 1000n + BigInt((match[2] ?? '').padEnd(3, '0'));
  if (thousandths <= 0n) throw new RangeError('quantity must be positive');
  return thousandths;
}

export function lineTotalMinor(line: Pick<QuoteLineInput, 'quantity' | 'unitPriceMinor'>): number {
  return Number(divRound(quantityThousandths(line.quantity) * BigInt(line.unitPriceMinor), 1000n));
}

export function computeQuoteTotals(input: QuoteTotalsInput): QuoteTotals {
  const bp = BigInt(input.vatRateBp);
  if (bp < 0n || bp > BP) throw new RangeError('vat rate out of range');

  const lineTotalsMinor = input.lines.map(lineTotalMinor);
  let excludingVat = 0n; // net amounts
  let includingVat = 0n; // gross amounts
  input.lines.forEach((line, i) => {
    const total = BigInt(lineTotalsMinor[i]!);
    if (line.vatIncluded) includingVat += total;
    else excludingVat += total;
  });

  // Net before discount N = E + I / (1 + r), kept exact as N × (BP + bp).
  const denominator = BP + bp;
  const subtotal = divRound(excludingVat * denominator + includingVat * BP, denominator);

  const value = BigInt(Math.max(0, Math.trunc(input.discountValue)));
  let discount = 0n;
  if (input.discountType === 'percent')
    discount = divRound(subtotal * (value > BP ? BP : value), BP);
  else if (input.discountType === 'amount') discount = value > subtotal ? subtotal : value;

  const taxable = subtotal - discount;

  let total: bigint;
  if (bp === 0n) {
    total = taxable;
  } else if (discount === 0n) {
    // Keep VAT-inclusive prices exactly; add VAT to the rest.
    total = divRound(excludingVat * denominator, BP) + includingVat;
  } else {
    const gross = excludingVat * denominator + includingVat * BP; // exact gross G = E × (1 + r) + I, × BP
    total =
      input.discountType === 'percent'
        ? // A percent comes off the gross exactly (50% of ₪100 is ₪50.00).
          divRound(gross * (BP - (value > BP ? BP : value)), BP * BP)
        : // An amount scales the gross by the share of the subtotal that is left.
          divRound(gross * taxable, BP * subtotal);
  }
  if (total < taxable) total = taxable;

  return {
    lineTotalsMinor,
    subtotalMinor: Number(subtotal),
    discountMinor: Number(discount),
    vatRateBp: input.vatRateBp,
    vatMinor: Number(total - taxable),
    totalMinor: Number(total),
  };
}
