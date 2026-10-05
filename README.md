# Quote-to-Cash

Quote-to-cash micro-SaaS for Israeli field tradespeople (electricians first).
Hebrew, RTL, mobile-first.

Flow: **Customer → Quote → Approval → Scheduling → Job → Invoice → Payment**.

## Repository layout

```
apps/
  mobile/        Expo (expo-router) app for iOS / Android
  web/           Next.js (App Router) web app
packages/
  config/        Shared ESLint, Prettier and tsconfig presets
  types/         Zod schemas: the single source of truth for data shapes
  ui/            Design tokens (colors, spacing, radius, typography) + Hebrew i18n strings
  utils/         Pure helpers (money in agorot, Israeli phone → E.164 and display format)
supabase/
  config.toml    Local Supabase stack (Supabase CLI)
  migrations/    SQL migrations: every DB change goes here
  functions/     Edge Functions (Deno); request logic in handler.ts, unit-tested with Vitest
  tests/         pgTAP tests (RLS tenant isolation, appointment overlap, schema rules)
  seed.sql       Two test businesses; local development and tests only
```

Workspace packages export TypeScript source directly (no build step); Metro and Next
(`transpilePackages`) compile them.

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- pnpm 10: `corepack enable` (the version is pinned in `package.json#packageManager`)
- Docker: only needed to run the local Supabase stack
- Expo Go on a phone, or an iOS simulator / Android emulator, for the mobile app

## Setup

```bash
corepack enable
pnpm install
cp .env.example .env          # fill in values; never commit .env
```

### Run locally

```bash
pnpm dev:web                  # Next.js on http://localhost:3000
pnpm dev:mobile               # Expo dev server; press i / a / w for iOS / Android / web
pnpm dev                      # both
```

### Local Supabase

```bash
pnpm supabase:start           # starts Postgres, Auth, Storage, Studio (Docker)
pnpm supabase:reset           # drops the local DB, applies supabase/migrations, loads seed.sql
pnpm supabase:test            # pgTAP tests in supabase/tests (needs the seed)
pnpm supabase:types           # regenerates packages/types/src/database.types.ts
pnpm supabase:stop
```

`supabase:start` prints the local `SUPABASE_URL` and anon key; copy them into `.env`.
Create migrations with `pnpm exec supabase migration new <name>`, then run `supabase:reset`,
`supabase:test` and `supabase:types` and commit the regenerated types (CI fails if they are stale).

`supabase/seed.sql` creates two businesses (A and B), each with an OWNER and an EMPLOYEE, their
settings, customers and price list. It holds no quotes, jobs, visits or invoices: those come only
from the app's own flows, so a missing flow cannot hide behind seed data (pgTAP fixtures build them
through `supabase/tests/helpers/flow.psql`). It is for local development and tests only and refuses
to run on a database that already has businesses. Never run it against production.

### Database model

- Every business table has `business_id`, and RLS lets only active members of that business
  (`app.is_member(business_id)`) select, insert and update its rows. There are no DELETE policies:
  rows are soft-deleted via `deleted_at`.
- Child rows reference their parents through `(business_id, id)` foreign keys, so a row can never
  point at another business's data.
- `business_member`, `business_settings` and `business` updates need OWNER or ADMIN; only an OWNER
  can grant or change the OWNER role. New businesses are created with `create_business(name)`,
  which makes the caller its OWNER.
- `quote_number` and `invoice_number` are assigned by the server per business and never change.
- Confirmed appointments of one business cannot overlap (`appointment_no_overlapping_confirmed`).
- A job is created only from an APPROVED quote, one per quote (`create_job_for_quote`, also run
  inside the customer's approval and the owner's `mark_quote_approved`). Every new appointment
  belongs to a job; jobs move only through `schedule_job` and `transition_job`.
- `subscription` is read-only for members (written by the billing backend); `audit_log` is
  insert-only for everyone, including the table owner.

## Sign-in and business setup

Phone OTP is the only sign-in method. The flow in the app:
Splash → Onboarding (3 slides, shown once) → phone → 6-digit code → Business Setup → Home.

- **Sign in locally** with these test numbers; they never receive an SMS and always accept
  code `123456` (`[auth.sms.test_otp]` in `supabase/config.toml`):

  | Number         | Who                                       |
  | -------------- | ----------------------------------------- |
  | `050-000-0001` | seed: OWNER of business A (`כהן חשמל`)    |
  | `050-000-0002` | seed: EMPLOYEE of business A              |
  | `050-000-0003` | seed: OWNER of business B (`מזרחי חשמל`)  |
  | `050-000-0004` | seed: EMPLOYEE of business B              |
  | `050-123-4567` | new user: goes through Business Setup     |
  | `050-123-4568` | new user, or the target of a phone change |

- **Limits:** a new code can be sent every 60 s (enforced by the server too), at most 3 codes per
  number per 10 minutes in the app, and 5 wrong codes lock verification until a new code is sent.
- **Business Setup** posts to the `business-setup` Edge Function, which validates with the same
  `BusinessSetupSchema` as the app and calls `setup_business()` as the user. The business id is
  generated by the app, so a retried submit never creates a second business. The logo goes to
  the private `business-assets` bucket (`<business_id>/logo.<ext>`, PNG/JPEG/WebP, 2 MB).
- **Session** is persisted with AsyncStorage (localStorage on web), so the user stays signed in
  after an app restart. Routes are guarded with `Stack.Protected`: everything under
  `apps/mobile/app/(app)` requires a signed-in user with a business.
- **Settings:** logout, change phone (a code to the current number, then a code to the new one)
  and an optional recovery email (confirmed by email; locally in Mailpit at
  http://127.0.0.1:54324).
- `user_profile` rows are created and kept in sync with `auth.users` by a database trigger.

The mobile app reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the root `.env` (through
`apps/mobile/app.config.ts`); without them it shows a configuration error screen.

**Production (hosted Supabase project):** configure a real SMS provider and keep its credentials in
the project settings, never in the repo; enable **Confirm phone** (otherwise a phone change is
applied without verifying the new number); keep the SMS cooldown at 60 s; and deploy the function
with `pnpm exec supabase functions deploy business-setup`. The local Twilio entries in
`config.toml` are placeholders for the test numbers only.

## Customers

Customers only (no leads, tags or segments), in `apps/mobile/app/(app)/customers`:

- **List**: most recently updated first, instant search by name (every word) or by any part of the
  phone in any format (`054-765`, `+97254`, `4321`). The latest 500 customers are kept on the device,
  so the list, search and details open offline from the last saved copy (with a notice).
- **Details**: call (`tel:`), WhatsApp (`wa.me`), addresses, and the customer's quote history.
- **Add / Edit**: name and phone are required; email, one address and notes are optional
  (`CustomerSchema` in `packages/types`). A phone that another active customer of the business
  already has shows that customer with a button to open it instead of saving a duplicate (also
  enforced by the `(business_id, phone_e164)` unique index).
- **Quick create**: name and phone only, `QuickCreateCustomer` (`QuickCustomerSchema`) for use
  inside other flows such as a new quote; also at `/customers/new?mode=quick`.
- **Delete** is a soft delete (`deleted_at`): the customer leaves the list, their quotes stay
  readable, and the phone can be used for a new customer.

All reads and writes go through the Supabase Data API under RLS (`src/customers/db.ts`); the save
and duplicate rules are in `src/customers/service.ts` and unit-tested with an in-memory database.

## Price list

Categories and services in `apps/mobile/app/(app)/price-list`:

- Each service has a name, category, unit (`unit`, `point`, `meter`, `sqm`, `hour`, `job`, shown in
  Hebrew), unit price in agorot (never negative), whether the price includes VAT, and a favorite flag.
- **Ordering:** favorites first, then recently used (`last_used_at`, set when a service is added to a
  quote), then by name in Hebrew order. Filter by category or favorites.
- **Search** is Hebrew-aware (`textMatches` in `packages/utils`): every word may match the name or
  the category, niqqud is ignored, final letters match regular ones, and `מאמ״ת` matches `מאמ"ת`.
- **Quick price edit:** tap the price, type, tap save.
- **Starter price lists** live in `packages/types/src/starter-price-lists/*.json` (electricians for
  now, prices before VAT). Business Setup offers to import it, and an empty price list imports it in
  one tap. `import_starter_price_list()` is idempotent: each entry has a `starter_key`, so a second
  import adds nothing, keeps edited prices and does not bring back deleted services.
- **Delete** is a soft delete. Quote lines (`quote_item`) keep their own copy of the description,
  unit and price, so existing quotes do not change. Deleting a category keeps its services, under
  "no category".

## Quotes

Create, send, revise and cancel quotes in `apps/mobile/app/(app)/quotes` (Home → "הצעת מחיר
חדשה", or from a customer's page).

- **Editor:** one screen with collapsible sections (customer, services, notes, photos) and a
  floating total. Services come from the price list (favorites, recently used, search) or as a
  free-form line; quantity allows up to 3 decimals; the discount is a percent or an amount. Every
  change is saved on the device right away and queued for the server (auto-save).
- **Totals** are computed by `computeQuoteTotals` in `packages/utils` (integer agorot, half away
  from zero, VAT-inclusive prices keep their exact gross; an exempt dealer charges no VAT). The app
  shows them live; the server recomputes them when sending, and those are stored.
- **Photos** are taken or picked, compressed on the device (JPEG, max 1600px wide) and uploaded in
  the background to the private `quote-photos` bucket (`<business>/quotes/<quote>/<photo>.jpg`) with
  a `file` row each.
- **Preview** shows the quote as the customer will see it. **Send** calls the `quotes` Edge
  Function (`POST /quotes/:id/send` with a `sendKey`), which checks the quote is a DRAFT,
  recomputes the totals, freezes a snapshot (business, customer, lines, totals, photos), creates a
  32-byte random token (only its HMAC with `TOKEN_PEPPER` is stored, with an expiry from the
  validity date or `quote_valid_days`) and lets `send_quote()` assign the next number under a lock.
  It returns the customer link (`PUBLIC_APP_URL/quote/<token>`) and a `wa.me` link with a Hebrew
  message. Retrying with the same `sendKey` returns the same number (never a second one).
- **Proposed visit times:** the preview lets the owner propose 2-3 visit times (day, start hour
  and length, Israel time) or none. They go with the send (`slots: [{ startsAt, endsAt }]`) and
  are stored by `send_quote()` as `quote_slot_option` rows (OFFERED; future, at most 12 hours,
  not overlapping each other). The quote details show them, and the one the customer booked.
- **Rules (database-enforced):** only drafts can be edited; status, number, token and snapshot
  change only through `send_quote` / `revise_quote` / `cancel_quote`. **Revise** copies a sent
  quote into a new draft revision; the old one becomes SUPERSEDED and its link is revoked.
  **Cancel** works on drafts and open quotes and revokes the link.
- **Offline:** quotes live in SQLite on the device (`expo-sqlite`, `src/quotes/store.ts`) with an
  outbox of changes (`src/quotes/outbox.ts`). The outbox is replayed on start, when the connection
  returns and with exponential backoff; every server call is idempotent (draft upserts by
  client-generated ids, sends by `sendKey`). A quote sent offline shows "ממתינה לשליחה" and becomes
  SENT only after the server confirms. A draft changed on another device after it was sent there
  takes the server's version.
- **Quotes list** filters by status; **details** show the customer's version, the history
  (created, sent, viewed, approved/rejected, cancelled, superseded, expired) and Revise / Cancel.

**Edge Function secrets:** `TOKEN_PEPPER` (a long random string) and `PUBLIC_APP_URL` must be set
for the `quotes` function (`pnpm exec supabase secrets set TOKEN_PEPPER=… PUBLIC_APP_URL=…` on the
hosted project; `pnpm exec supabase functions serve --env-file .env` locally). Deploy with
`pnpm exec supabase functions deploy quotes`.

**Web build:** the mobile web build is a single-page app (`web.output: "single"`); a host must
serve `index.html` for every path.

## Customer quote page and PDF

The link a customer receives, `PUBLIC_APP_URL/quote/<token>`, opens a Next.js page
(`apps/web/app/quote/[token]`): RTL, mobile-first, with the business's logo and details. No sign-in
and no app install.

- **Data** comes only from the `public-quote` Edge Function (`verify_jwt = false`), called from the
  customer's browser so it sees their IP. It hashes the token with `TOKEN_PEPPER` and calls
  service-role-only database functions (`public_quote_open`, `public_quote_respond`,
  `public_quote_comment`, `public_quote_schedule`); the page never touches the database.
- **States:** the first open marks the quote VIEWED; an open past the link's expiry marks it EXPIRED.
  Expired, cancelled, superseded (a newer revision was sent) and already-approved quotes get clear
  Hebrew pages. Unknown, malformed and revoked tokens get byte-identical `404` responses.
- **Approve** requires typing a name; the name, IP and time are stored on the quote and in
  `audit_log`. Approving (or rejecting) twice returns the first answer. **Reject** takes an
  optional reason; **comments** go to `quote_comment` for the business.
- **Scheduling:** an open quote lists the proposed times; once approved, the customer picks one
  (`POST /public-quote/<token>/schedule` with `{ slotId }`). That books a CONFIRMED `appointment`
  (the chosen time becomes SELECTED, the others DECLINED). Times that overlap another confirmed
  visit of the business, or have passed, show as taken; if one is taken meanwhile, the
  `appointment_no_overlapping_confirmed` exclusion constraint refuses it and the function answers
  `409 { "error": "conflict" }`, so the page asks for another time. Picking the booked time again
  returns it; a different time after booking is refused (`409 already_scheduled`).
- **Rate limits** (per minute): 60 page loads and 10 answers per IP, 30 requests per link
  (`hit_rate_limit()`).
- **Security:** every value is rendered as text (React escaping, no raw HTML); quote pages are
  `noindex`, `no-store`, `Referrer-Policy: no-referrer` and cannot be framed.
- **PDF:** `GET /quote/<token>/pdf` prints the same page (`?print=1`) with headless Chromium
  (`playwright-core`, `apps/web/src/pdf/render.ts`), with the Heebo font for Hebrew. Set
  `CHROMIUM_EXECUTABLE_PATH` where Chromium is not at a standard path (on serverless hosts, a
  packaged Chromium such as `@sparticuz/chromium`). `PDF_RENDER_ORIGIN` optionally overrides the
  origin Chromium loads the page from.

Deploy with `pnpm exec supabase functions deploy public-quote` (it needs `TOKEN_PEPPER`). The web
app reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the root `.env`.

## Notifications and the action queue

**Home is the action queue** (`action_queue()`, runs under RLS): quotes sent and not answered
("send reminder" opens WhatsApp with a prefilled text), approved quotes with no appointment
("schedule"), completed jobs with no invoice ("create invoice"), unpaid invoices with the amount
due ("payment reminder" on WhatsApp), and pushes that never reached you ("got it" dismisses them).
A big "new quote" button sits on top; with nothing waiting it shows a friendly empty state. The
lists reload whenever the screen is shown, on pull-to-refresh and when a push arrives.

**Push.** After sign-in the app asks for permission and registers its Expo push token through
the `devices` Edge Function (`POST /devices`; `DELETE /devices` on sign-out). Database triggers
queue one push per recipient in `notification` for: quote viewed, approved and rejected;
appointment created and changed (moved, confirmed, cancelled); a reminder the evening before
(from 18:00 business time); invoice issued; payment received. Recipients are the business's
OWNER/ADMIN members and, for appointments, the assigned member, minus anyone who turned the event
off in Settings → Notifications. The `notify` Edge Function claims queued pushes, sends them
through Expo and records the outcome: rate limits and lost requests are retried up to 3 times;
anything else (including no registered device) is FAILED and stays in the recipient's action
queue. Tokens Expo no longer knows are removed.

**Analytics.** The same triggers record `quote_created`, `quote_sent`, `quote_viewed`,
`quote_approved`, `quote_rejected`, `appointment_created`, `job_completed`, `invoice_created`,
`invoice_sent` and `payment_received` in `app.analytics_event` (ids and amounts only, no names or
phone numbers); `notify` forwards them to PostHog. The app sends `app_opened` itself. Without
`POSTHOG_KEY` nothing is sent.

**Wiring `notify`.** pg_net calls it right after a push is queued and pg_cron every minute. Both
read two Vault secrets and do nothing until they exist:

```sql
select vault.create_secret('https://<project>.supabase.co/functions/v1/notify', 'notify_url');
select vault.create_secret('<same value as NOTIFY_SECRET>', 'notify_secret');
```

Deploy with `pnpm exec supabase functions deploy notify devices` and set `NOTIFY_SECRET` (and
`POSTHOG_KEY`, optionally `POSTHOG_HOST` and `EXPO_ACCESS_TOKEN`) with `supabase secrets set`.
Push tokens need the app's EAS project id in `EXPO_PROJECT_ID`.

## Invoices and payments

Home → "חשבוניות ותשלומים" (`apps/mobile/app/(app)/invoices`). Invoicing sits behind an
interface, so a real invoicing service can be added later without touching the rest.

- **Provider interface:** `InvoiceProvider` (`createInvoice`, `getStatus`, `voidInvoice`) in
  `packages/types/src/invoice.ts`. Each business selects its provider in
  `business_settings.invoice_provider`; the `invoices` Edge Function picks it from
  `InvoiceProviderRegistry` (`supabase/functions/invoices/providers`). The only provider today is
  `manual`. A new provider implements the interface and is added to the registry,
  `INVOICE_PROVIDER_IDS` and the two `provider` check constraints.
- **Manual flow:** a COMPLETED job shows under "עבודות שהסתיימו"; "הכנת חשבונית" creates a NOT_ISSUED
  invoice and its lines from the job's quote snapshot. The invoice page shows a data sheet to copy
  or share into the owner's invoicing software; the owner then records the document number
  (ISSUED), and marks it sent and paid (with the payment method; a `payment` row is recorded).
  The "לא שולמו" list (ISSUED and SENT) has a WhatsApp payment reminder for each invoice.
- **Statuses:** NOT_ISSUED → ISSUED / FAILED / VOIDED; FAILED → ISSUED / VOIDED; ISSUED → SENT /
  PAID / VOIDED; SENT → PAID / VOIDED. PAID and VOIDED are final. Stored lowercase
  (`not_issued`, …) like the other status enums.
- **Rules (database-enforced):** only COMPLETED jobs can be invoiced, one live (not voided) invoice
  per job, creation is idempotent per `idempotency_key`, a document number is used once per
  business and never changes, the billed amounts never change, and invoices, lines and payments
  are never deleted (void instead). Clients only read these tables; every change goes through the
  `invoices` Edge Function and the service-role functions `create_invoice` / `transition_invoice`.
- **Not implemented:** Israeli Tax Authority logic (allocation numbers and document types); see the
  `TODO(tax-authority)` notes. Under the manual provider the owner's invoicing software handles it.

Deploy with `pnpm exec supabase functions deploy invoices`.

## Quality checks

The same commands run in CI (`.github/workflows/ci.yml`):

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build

# database job (Docker)
pnpm exec supabase db start
pnpm supabase:reset
pnpm supabase:test
pnpm supabase:types && git diff --exit-code -- packages/types/src/database.types.ts
```

## Environment variables

See `.env.example`. Secrets are never committed.

| Variable                   | Used by                                           |
| -------------------------- | ------------------------------------------------- |
| `SUPABASE_URL`             | apps, Edge Functions                              |
| `SUPABASE_ANON_KEY`        | apps                                              |
| `TOKEN_PEPPER`             | Edge Functions only (server secret)               |
| `SENTRY_DSN`               | error reporting                                   |
| `POSTHOG_KEY`              | product analytics (app and `notify`)              |
| `POSTHOG_HOST`             | PostHog host (default `https://eu.i.posthog.com`) |
| `EXPO_PROJECT_ID`          | app: EAS project for Expo push tokens             |
| `EXPO_ACCESS_TOKEN`        | `notify`: Expo push security token (optional)     |
| `NOTIFY_SECRET`            | `notify`: shared with Vault `notify_secret`       |
| `PUBLIC_APP_URL`           | absolute links sent to customers (web base URL)   |
| `CHROMIUM_EXECUTABLE_PATH` | web PDF route: Chromium binary (optional)         |

## Conventions

- TypeScript strict everywhere; Zod schemas live in `packages/types` and are used on client and server.
- IDs are UUIDs (client-generated allowed).
- Money is an integer number of agorot in `*_minor` fields; use `toMinor` / `formatMoney` from `@q2c/utils`.
- Phones are stored in E.164; normalize input with `toE164IL`.
- Timestamps are stored in UTC and displayed in `Asia/Jerusalem`.
- Soft delete via `deleted_at`. Every business table has `business_id` and RLS via `app.is_member(business_id)`.
- Roles: `OWNER`, `ADMIN`, `EMPLOYEE`.
- All UI strings come from `packages/ui/src/i18n/he.ts` (ESLint `react/jsx-no-literals` blocks inline JSX text).
- Every screen handles loading, empty, error and success states.
- Extra ideas go into `FUTURE.md`, not into code.

## RTL

- **Web**: `<html lang="he" dir="rtl">` in `apps/web/app/layout.tsx`; layout uses logical CSS
  properties (`margin-inline`, `padding-inline`).
- **Mobile**: `app.json` sets `extra.supportsRTL` / `extra.forcesRTL` (native builds start in RTL);
  `forceRtl()` in `apps/mobile/src/rtl.ts` also calls `I18nManager.forceRTL(true)` for Expo Go and dev
  clients. In Expo Go, the first launch may need one reload before RTL takes effect.
  The mobile web build sets `dir="rtl"` in `apps/mobile/public/index.html`.
- The home screen of both apps shows the 7 flow steps; step 1 must render on the **right**.

## Design tokens

Defined once in `packages/ui/src/tokens.ts`: primary `#0F6B5C`, accent `#F59E0B`, 12px radius,
8px spacing grid, 48px minimum touch target, Heebo font, light and dark themes. The web app consumes
them as CSS variables generated by `themeCss()`; the mobile app imports them directly.
