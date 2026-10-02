import { strings } from '@q2c/ui';
import { formatMoney, toE164IL } from '@q2c/utils';

const FLOW_STEPS = [
  strings.flow.customer,
  strings.flow.quote,
  strings.flow.approval,
  strings.flow.scheduling,
  strings.flow.job,
  strings.flow.invoice,
  strings.flow.payment,
];

const SAMPLE_AMOUNT_MINOR = 123450;
const SAMPLE_PHONE = toE164IL('052-123-4567');

export default function HomePage() {
  return (
    <main className="container">
      <header>
        <h1>{strings.app.name}</h1>
        <p className="muted">{strings.app.tagline}</p>
      </header>

      <section className="card">
        <h2>{strings.home.title}</h2>
        <p>{strings.home.subtitle}</p>
      </section>

      <section className="card" aria-labelledby="flow-title">
        <h2 id="flow-title">{strings.home.flowTitle}</h2>
        <ol className="flow">
          {FLOW_STEPS.map((step, index) => (
            <li key={step} className="chip">
              <span className="chip-index">{index + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </section>

      <section className="card" aria-labelledby="sample-title">
        <h2 id="sample-title">{strings.home.sampleTitle}</h2>
        <div className="row">
          <span className="muted">{strings.home.sampleAmountLabel}</span>
          <span>{formatMoney(SAMPLE_AMOUNT_MINOR)}</span>
        </div>
        <div className="row">
          <span className="muted">{strings.home.samplePhoneLabel}</span>
          <span className="ltr">{SAMPLE_PHONE}</span>
        </div>
      </section>
    </main>
  );
}
