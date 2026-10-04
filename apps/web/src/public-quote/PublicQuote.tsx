'use client';

import {
  PublicQuoteApproveSchema,
  PublicQuoteCommentSchema,
  PublicQuoteRejectSchema,
  PublicQuoteScheduleSchema,
  type PublicQuoteSlot,
} from '@q2c/types';
import { errorMessage, format, strings } from '@q2c/ui';
import { formatSlotIL } from '@q2c/utils';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  approveQuote,
  loadQuote,
  rejectQuote,
  scheduleVisit,
  sendComment,
  type Failure,
  type QuoteView,
} from './api';
import { QuoteDocument } from './QuoteDocument';

const t = strings.publicQuote;

type PageState = { kind: 'loading' } | { kind: 'ready'; view: QuoteView } | Failure;

/** The customer's quote page: no sign-in, everything through the link token. */
export function PublicQuote({ token, print }: { token: string; print: boolean }) {
  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadQuote(token).then((result) => {
      if (cancelled) return;
      setState(result.kind === 'ok' ? { kind: 'ready', view: result.data } : result);
    });
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  const retry = () => {
    setState({ kind: 'loading' });
    setAttempt((n) => n + 1);
  };

  if (state.kind === 'loading')
    return (
      <Message title={t.loading} busy>
        <span className="spinner" aria-hidden />
      </Message>
    );
  if (state.kind === 'not_found') return <Message title={t.notFoundTitle} body={t.notFoundBody} />;
  if (state.kind === 'rate_limited')
    return <Message title={t.rateLimitedTitle} body={t.rateLimitedBody} onRetry={retry} />;
  if (state.kind !== 'ready')
    return <Message title={t.errorTitle} body={t.errorBody} onRetry={retry} />;

  const { view } = state;
  if (view.state === 'cancelled')
    return (
      <Message
        title={t.cancelledTitle}
        body={format(t.cancelledBody, { business: view.business.name })}
      />
    );
  if (view.state === 'superseded')
    return (
      <Message
        title={t.supersededTitle}
        body={format(t.supersededBody, { business: view.business.name })}
      />
    );
  if (view.state === 'expired')
    return (
      <Message
        title={t.expiredTitle}
        body={format(t.expiredBody, { business: view.quote.business.name })}
      />
    );

  const update = (next: QuoteView, message: string | null) => {
    setState({ kind: 'ready', view: next });
    setNotice(message);
  };

  /** Reloads the page data in place (no loading screen); false if that failed. */
  const refresh = async () => {
    const result = await loadQuote(token);
    if (result.kind === 'ok') setState({ kind: 'ready', view: result.data });
    return result.kind === 'ok';
  };

  return (
    <main className="container quote-page" data-ready="true" data-state={view.state}>
      {notice ? (
        <p className="notice" role="status" data-testid="quote-notice">
          {notice}
        </p>
      ) : null}
      <QuoteDocument
        quote={view.quote}
        logoUrl={view.logoUrl}
        photoUrls={view.photoUrls}
        approval={view.approval}
        rejection={view.rejection}
      />
      {print ? null : (
        <>
          {view.state === 'open' ? (
            <Answer
              token={token}
              businessName={view.quote.business.name}
              hasSlots={view.slots.length > 0}
              onAnswered={update}
              onClosed={() => {
                setNotice(t.closedNow);
                retry();
              }}
            />
          ) : null}
          {view.appointment ? (
            <section className="card" data-testid="quote-appointment">
              <h2>{t.scheduledTitle}</h2>
              <p>{formatSlotIL(view.appointment.startsAt, view.appointment.endsAt)}</p>
            </section>
          ) : view.state === 'approved' && view.slots.length > 0 ? (
            <Schedule
              token={token}
              businessName={view.quote.business.name}
              slots={view.slots}
              onScheduled={update}
              onRefresh={refresh}
              onClosed={() => {
                setNotice(t.scheduleAlready);
                retry();
              }}
            />
          ) : view.state === 'open' && view.slots.length > 0 ? (
            <section className="card" data-testid="quote-slots">
              <h2>{t.slotsTitle}</h2>
              <ul className="slot-list">
                {view.slots.map((slot) => (
                  <li key={slot.id}>{formatSlotIL(slot.startsAt, slot.endsAt)}</li>
                ))}
              </ul>
              <p className="muted">{t.slotsAfterApproval}</p>
            </section>
          ) : null}
          <Comment token={token} />
          <a
            className="button button-secondary"
            href={`/quote/${encodeURIComponent(token)}/pdf`}
            data-testid="quote-pdf"
            download
          >
            {t.downloadPdf}
          </a>
          <p className="muted small">{format(t.poweredBy, { app: strings.app.name })}</p>
        </>
      )}
    </main>
  );
}

function Message({
  title,
  body,
  busy,
  onRetry,
  children,
}: {
  title: string;
  body?: string;
  busy?: boolean;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  return (
    <main className="container center" aria-busy={busy} data-testid="quote-message">
      {children}
      <h1>{title}</h1>
      {body ? <p className="muted">{body}</p> : null}
      {onRetry ? (
        <button type="button" className="button" onClick={onRetry}>
          {t.retry}
        </button>
      ) : null}
    </main>
  );
}

function failureText(result: Failure): string {
  if (result.kind === 'invalid') return errorMessage(result.error);
  if (result.kind === 'rate_limited') return t.rateLimitedBody;
  if (result.kind === 'not_found') return t.notFoundBody;
  return t.errorBody;
}

/** Approve (typed name) or reject (optional reason). */
function Answer({
  token,
  businessName,
  hasSlots,
  onAnswered,
  onClosed,
}: {
  token: string;
  businessName: string;
  hasSlots: boolean;
  onAnswered: (view: QuoteView, message: string) => void;
  onClosed: () => void;
}) {
  const [mode, setMode] = useState<'approve' | 'reject'>('approve');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    // Same rules as the server (packages/types).
    const parsed =
      mode === 'approve'
        ? PublicQuoteApproveSchema.safeParse({ name })
        : PublicQuoteRejectSchema.safeParse({ reason });
    if (!parsed.success)
      return setError(errorMessage(parsed.error.issues[0]?.message ?? 'generic'));
    setBusy(true);
    const result =
      mode === 'approve' ? await approveQuote(token, name) : await rejectQuote(token, reason);
    setBusy(false);
    if (result.kind === 'ok')
      return onAnswered(
        result.data,
        mode === 'reject'
          ? t.rejectedNow
          : hasSlots
            ? t.approvedNowPick
            : format(t.approvedNow, { business: businessName }),
      );
    if (result.kind === 'closed') return onClosed();
    setError(failureText(result));
  };

  return (
    <form className="card" onSubmit={submit} noValidate data-testid="quote-answer">
      {mode === 'approve' ? (
        <>
          <h2>{t.approveTitle}</h2>
          <p className="muted">{t.approveBody}</p>
          <label className="field">
            <span>{t.approveName}</span>
            <input
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              aria-invalid={error ? true : undefined}
              data-testid="approve-name"
            />
          </label>
        </>
      ) : (
        <>
          <h2>{t.reject}</h2>
          <label className="field">
            <span>{t.rejectReason}</span>
            <textarea
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              rows={3}
              data-testid="reject-reason"
            />
          </label>
        </>
      )}
      {error ? (
        <p className="error" role="alert" data-testid="answer-error">
          {error}
        </p>
      ) : null}
      <button type="submit" className="button" disabled={busy} data-testid={`${mode}-submit`}>
        {mode === 'approve'
          ? busy
            ? t.approving
            : t.approve
          : busy
            ? t.rejecting
            : t.rejectConfirm}
      </button>
      <button
        type="button"
        className="button button-ghost"
        onClick={() => {
          setMode(mode === 'approve' ? 'reject' : 'approve');
          setError(null);
        }}
        data-testid={mode === 'approve' ? 'show-reject' : 'show-approve'}
      >
        {mode === 'approve' ? t.reject : t.back}
      </button>
    </form>
  );
}

/** After approval: pick one of the proposed visit times. */
function Schedule({
  token,
  businessName,
  slots,
  onScheduled,
  onRefresh,
  onClosed,
}: {
  token: string;
  businessName: string;
  slots: PublicQuoteSlot[];
  onScheduled: (view: QuoteView, message: string) => void;
  onRefresh: () => Promise<boolean>;
  onClosed: () => void;
}) {
  const [slotId, setSlotId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const free = slots.filter((slot) => slot.available);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    // Same rules as the server (packages/types).
    const parsed = PublicQuoteScheduleSchema.safeParse({ slotId });
    if (!parsed.success)
      return setError(errorMessage(parsed.error.issues[0]?.message ?? 'generic'));
    setBusy(true);
    const result = await scheduleVisit(token, parsed.data.slotId);
    if (result.kind === 'conflict') {
      // Someone else got that time: show what is still free.
      await onRefresh();
      setSlotId(null);
      setBusy(false);
      return setError(t.scheduleConflict);
    }
    setBusy(false);
    if (result.kind === 'ok') {
      const booked = 'appointment' in result.data ? result.data.appointment : null;
      return onScheduled(
        result.data,
        format(t.scheduledNow, {
          business: businessName,
          when: booked ? formatSlotIL(booked.startsAt, booked.endsAt) : '',
        }),
      );
    }
    if (result.kind === 'closed') return onClosed();
    setError(failureText(result));
  };

  return (
    <form className="card" onSubmit={submit} noValidate data-testid="quote-schedule">
      <h2>{t.scheduleTitle}</h2>
      {free.length === 0 ? (
        <p className="muted" data-testid="schedule-none-free">
          {format(t.scheduleNoneFree, { business: businessName })}
        </p>
      ) : (
        <>
          <p className="muted">{format(t.scheduleBody, { business: businessName })}</p>
          <fieldset className="slot-list" aria-invalid={error ? true : undefined}>
            <legend className="sr-only">{t.scheduleTitle}</legend>
            {slots.map((slot) => (
              <label
                key={slot.id}
                className={`slot-option${slot.available ? '' : ' slot-option-taken'}`}
              >
                <input
                  type="radio"
                  name="slot"
                  value={slot.id}
                  checked={slotId === slot.id}
                  disabled={!slot.available || busy}
                  onChange={() => setSlotId(slot.id)}
                  data-testid={`slot-${slot.id}`}
                />
                <span>{formatSlotIL(slot.startsAt, slot.endsAt)}</span>
                {slot.available ? null : <span className="muted small">{t.slotTaken}</span>}
              </label>
            ))}
          </fieldset>
        </>
      )}
      {error ? (
        <p className="error" role="alert" data-testid="schedule-error">
          {error}
        </p>
      ) : null}
      {free.length > 0 ? (
        <button type="submit" className="button" disabled={busy} data-testid="schedule-submit">
          {busy ? t.scheduling : t.scheduleSubmit}
        </button>
      ) : null}
    </form>
  );
}

function Comment({ token }: { token: string }) {
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = PublicQuoteCommentSchema.safeParse({ body });
    if (!parsed.success)
      return setStatus({
        ok: false,
        text: errorMessage(parsed.error.issues[0]?.message ?? 'generic'),
      });
    setBusy(true);
    const result = await sendComment(token, body);
    setBusy(false);
    if (result.kind === 'ok') {
      setBody('');
      return setStatus({ ok: true, text: t.commentSent });
    }
    setStatus({ ok: false, text: failureText(result) });
  };

  return (
    <form className="card" onSubmit={submit} noValidate data-testid="quote-comment">
      <label className="field">
        <span>{t.commentTitle}</span>
        <textarea
          name="comment"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t.commentPlaceholder}
          maxLength={2000}
          rows={3}
          data-testid="comment-body"
        />
      </label>
      {status ? (
        <p className={status.ok ? 'success' : 'error'} role={status.ok ? 'status' : 'alert'}>
          {status.text}
        </p>
      ) : null}
      <button
        type="submit"
        className="button button-secondary"
        disabled={busy}
        data-testid="comment-send"
      >
        {t.commentSend}
      </button>
    </form>
  );
}
