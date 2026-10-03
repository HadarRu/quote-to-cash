import type { QuoteSnapshot } from '@q2c/types';
import { format, strings } from '@q2c/ui';
import { formatDateIL, formatDateTimeIL, formatMoney, formatPhoneIL } from '@q2c/utils';

const unitLabel = (unit: string) => (strings.units as Record<string, string>)[unit] ?? unit;
const t = strings.publicQuote;

interface QuoteDocumentProps {
  quote: QuoteSnapshot;
  logoUrl: string | null;
  photoUrls: string[];
  approval: { name: string; at: string } | null;
  rejection: { reason: string | null; at: string } | null;
}

/**
 * The quote as the customer sees it, also printed to PDF. Every value is
 * rendered as text (React escapes it); nothing here sets HTML.
 */
export function QuoteDocument({
  quote,
  logoUrl,
  photoUrls,
  approval,
  rejection,
}: QuoteDocumentProps) {
  const { business, customer, totals } = quote;
  return (
    <article className="quote" data-testid="quote-document" data-quote-number={quote.quote_number}>
      <header className="card quote-header">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, printed as is
          <img className="quote-logo" src={logoUrl} alt="" />
        ) : null}
        <div className="quote-business">
          <h1>{business.name}</h1>
          {business.tax_id ? (
            <p className="muted">{format(t.taxId, { id: business.tax_id })}</p>
          ) : null}
          {business.phone ? (
            <p className="muted">
              <bdi className="ltr">{formatPhoneIL(business.phone)}</bdi>
            </p>
          ) : null}
          {business.email ? (
            <p className="muted">
              <bdi className="ltr">{business.email}</bdi>
            </p>
          ) : null}
        </div>
      </header>

      <section className="card">
        <h2 data-testid="quote-title">
          {quote.quote_number ? format(t.titleNumber, { number: quote.quote_number }) : t.title}
          {quote.revision > 1 ? (
            <span className="muted">{` · ${format(t.revision, { revision: quote.revision })}`}</span>
          ) : null}
        </h2>
        <div className="row">
          <span className="muted">{t.date}</span>
          <span>{quote.sent_at ? formatDateIL(quote.sent_at) : ''}</span>
        </div>
        <div className="row">
          <span className="muted">{t.validUntil}</span>
          <span>{formatDateIL(`${quote.valid_until}T12:00:00Z`)}</span>
        </div>
        <div className="quote-customer">
          <span className="muted">{t.for}</span>
          <strong data-testid="quote-customer">{customer.full_name}</strong>
          <bdi className="ltr muted">{formatPhoneIL(customer.phone)}</bdi>
          {customer.address ? <span className="muted">{customer.address}</span> : null}
        </div>
        {quote.title ? <p className="quote-subject">{quote.title}</p> : null}
      </section>

      <section className="card">
        <h2>{t.items}</h2>
        <table className="quote-items">
          <thead>
            <tr>
              <th scope="col">{t.description}</th>
              <th scope="col">{t.quantity}</th>
              <th scope="col">{t.unitPrice}</th>
              <th scope="col">{t.lineTotal}</th>
            </tr>
          </thead>
          <tbody>
            {quote.items.map((item, i) => (
              <tr key={i} data-testid="quote-item">
                <td>
                  {item.description}
                  {item.vat_included ? (
                    <span className="muted">{` (${t.vatIncludedNote})`}</span>
                  ) : null}
                </td>
                <td className="num">{`${item.quantity} ${unitLabel(item.unit)}`}</td>
                <td className="num">{formatMoney(item.unit_price_minor)}</td>
                <td className="num">{formatMoney(item.line_total_minor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="quote-totals">
          <div className="row">
            <dt>{t.subtotal}</dt>
            <dd>{formatMoney(totals.subtotal_minor)}</dd>
          </div>
          {totals.discount_minor > 0 ? (
            <div className="row">
              <dt>{t.discount}</dt>
              <dd>{`−${formatMoney(totals.discount_minor)}`}</dd>
            </div>
          ) : null}
          {totals.vat_rate_bp > 0 ? (
            <div className="row">
              <dt>{format(t.vat, { rate: totals.vat_rate_bp / 100 })}</dt>
              <dd>{formatMoney(totals.vat_minor)}</dd>
            </div>
          ) : (
            <p className="muted">{t.noVat}</p>
          )}
          <div className="row quote-total">
            <dt>{t.total}</dt>
            <dd data-testid="quote-total">{formatMoney(totals.total_minor)}</dd>
          </div>
        </dl>
      </section>

      {quote.notes ? (
        <section className="card">
          <h2>{t.terms}</h2>
          <p className="quote-notes">{quote.notes}</p>
        </section>
      ) : null}

      {photoUrls.length ? (
        <section className="card">
          <h2>{t.photos}</h2>
          <div className="quote-photos">
            {photoUrls.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element -- signed Storage URLs, printed as is
              <img key={url} src={url} alt="" />
            ))}
          </div>
        </section>
      ) : null}

      {approval ? (
        <section className="card quote-approval" data-testid="quote-approval">
          <h2>{t.approvedTitle}</h2>
          <p>
            {format(t.approvedBy, { name: approval.name, date: formatDateTimeIL(approval.at) })}
          </p>
        </section>
      ) : null}
      {rejection ? (
        <section className="card" data-testid="quote-rejection">
          <h2>{t.rejectedTitle}</h2>
          <p>{format(t.rejectedOn, { date: formatDateTimeIL(rejection.at) })}</p>
          {rejection.reason ? <p className="muted">{rejection.reason}</p> : null}
        </section>
      ) : null}
    </article>
  );
}
