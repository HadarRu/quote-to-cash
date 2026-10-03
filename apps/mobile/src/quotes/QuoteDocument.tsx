import { format, radius, space, strings } from '@q2c/ui';
import {
  formatDateIL,
  formatMoney,
  formatPhoneIL,
  lineTotalMinor,
  parseMoneyInput,
} from '@q2c/utils';
import { Image, StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { useThemeColors } from '../theme';
import type { LocalQuote } from './model';

type Totals = NonNullable<LocalQuote['serverTotals']>;

/** Unit code -> Hebrew label; free text units are shown as typed. */
export function unitLabel(unit: string): string {
  return (strings.units as Record<string, string>)[unit] ?? unit;
}

/** "הצעה 12" once numbered, "טיוטה" before. */
export function quoteLabel(quote: Pick<LocalQuote, 'quoteNumber'>): string {
  return quote.quoteNumber === null
    ? strings.quotes.draftLabel
    : format(strings.quotes.number, { number: quote.quoteNumber });
}

/** Subtotal, discount, VAT and total, as on the customer's copy. */
export function TotalsTable({ totals }: { totals: Totals }) {
  const colors = useThemeColors();
  return (
    <View style={styles.totals} testID="quote-totals">
      <Row label={strings.quotes.subtotal} value={formatMoney(totals.subtotalMinor)} />
      {totals.discountMinor > 0 ? (
        <Row label={strings.quotes.discount} value={`−${formatMoney(totals.discountMinor)}`} />
      ) : null}
      {totals.vatRateBp > 0 ? (
        <Row
          label={format(strings.quotes.vat, { rate: totals.vatRateBp / 100 })}
          value={formatMoney(totals.vatMinor)}
        />
      ) : (
        <AppText variant="muted">{strings.quotes.noVat}</AppText>
      )}
      <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
        <AppText variant="heading">{strings.quotes.total}</AppText>
        <AppText variant="heading" testID="quote-total">
          {formatMoney(totals.totalMinor)}
        </AppText>
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <AppText>{label}</AppText>
      <AppText>{value}</AppText>
    </View>
  );
}

interface QuoteDocumentProps {
  quote: LocalQuote;
  totals: Totals;
  business: { name: string; logoUrl: string | null };
  photoUris: string[];
}

/** The quote as the customer sees it (Preview, and the details of a sent quote). */
export function QuoteDocument({ quote, totals, business, photoUris }: QuoteDocumentProps) {
  const colors = useThemeColors();
  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];
  return (
    <View style={styles.document} testID="quote-document">
      <View style={card}>
        <View style={styles.header}>
          {business.logoUrl ? (
            <Image source={{ uri: business.logoUrl }} style={styles.logo} />
          ) : null}
          <View style={styles.grow}>
            <AppText variant="title">{business.name}</AppText>
            <AppText variant="muted">
              {`${quoteLabel(quote)} · ${strings.quotes.quoteDate} ${formatDateIL(quote.sentAt ?? quote.updatedAt)}`}
            </AppText>
            {quote.validUntil ? (
              <AppText variant="muted">
                {`${strings.quotes.validUntilLabel} ${formatDateIL(`${quote.validUntil}T12:00:00Z`)}`}
              </AppText>
            ) : null}
          </View>
        </View>
        <View>
          <AppText variant="muted">{strings.quotes.previewFor}</AppText>
          <AppText testID="quote-customer">{quote.customerName ?? ''}</AppText>
          {quote.customerPhone ? (
            <AppText variant="muted" style={styles.ltr}>
              {formatPhoneIL(quote.customerPhone)}
            </AppText>
          ) : null}
        </View>
        {quote.title ? <AppText variant="heading">{quote.title}</AppText> : null}
      </View>

      <View style={card}>
        <AppText variant="heading">{strings.quotes.items}</AppText>
        {quote.lines.map((line) => {
          const price = parseMoneyInput(line.priceText) ?? 0;
          let total = 0;
          try {
            total = lineTotalMinor({ quantity: line.quantity, unitPriceMinor: price });
          } catch {
            // An incomplete line is shown without a total.
          }
          return (
            <View key={line.id} style={[styles.item, { borderBottomColor: colors.border }]}>
              <View style={styles.grow}>
                <AppText>{line.description}</AppText>
                <AppText variant="muted">
                  {`${line.quantity} ${unitLabel(line.unit)} × ${formatMoney(price)}${
                    line.vatIncluded ? ` (${strings.priceList.vatIncluded})` : ''
                  }`}
                </AppText>
              </View>
              <AppText>{formatMoney(total)}</AppText>
            </View>
          );
        })}
        <TotalsTable totals={totals} />
      </View>

      {quote.notes ? (
        <View style={card}>
          <AppText variant="heading">{strings.quotes.notesSection}</AppText>
          <AppText>{quote.notes}</AppText>
        </View>
      ) : null}

      {photoUris.length ? (
        <View style={card}>
          <AppText variant="heading">{strings.quotes.photosSection}</AppText>
          <View style={styles.photos}>
            {photoUris.map((uri) => (
              <Image key={uri} source={{ uri }} style={styles.photo} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  document: { gap: space(2) },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space(2),
    gap: space(1.5),
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  logo: { width: 56, height: 56, borderRadius: radius.md },
  grow: { flex: 1, gap: space(0.5) },
  ltr: { writingDirection: 'ltr', textAlign: 'right' },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space(1),
    paddingBottom: space(1),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  totals: { gap: space(0.5) },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space(1),
    marginTop: space(0.5),
  },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1) },
  photo: { width: 96, height: 96, borderRadius: radius.md },
});
