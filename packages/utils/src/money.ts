const MINOR_PER_MAJOR = 100;

function assertMinor(minor: number): number {
  if (!Number.isSafeInteger(minor))
    throw new RangeError('money must be an integer number of agorot');
  return minor;
}

/** Converts shekels (e.g. 12.5) to integer agorot (1250), rounding half away from zero. */
export function toMinor(major: number): number {
  if (!Number.isFinite(major)) throw new RangeError('amount must be finite');
  // toFixed avoids binary float artefacts such as 1.005 * 100 = 100.49999...
  const minor =
    Math.sign(major) * Math.round(Number((Math.abs(major) * MINOR_PER_MAJOR).toFixed(6)));
  return assertMinor(minor === 0 ? 0 : minor);
}

/** Converts integer agorot to shekels. */
export function fromMinor(minor: number): number {
  return assertMinor(minor) / MINOR_PER_MAJOR;
}

const ilsFormatter = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats agorot as an ILS display string in Hebrew locale, e.g. 123450 -> "‏1,234.50 ‏₪". */
export function formatMoney(minor: number): string {
  return ilsFormatter.format(fromMinor(minor));
}
