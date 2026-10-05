# Integration and E2E tests

Suites that need the local Supabase stack. Unit tests live next to the code in each package (`pnpm test`; merged coverage report: `pnpm coverage`, written to `coverage/`).

| Suite                                                    | Where                                                                                                                           | Runs in CI job              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Edge Functions, API errors and validation                | `integration/edge-functions.test.ts`                                                                                            | `integration`               |
| Tenant isolation over the Data API, RPCs and Storage     | `integration/tenant-isolation.test.ts` (the SQL-level suite is `supabase/tests/rls_tenant_isolation.test.sql`)                  | `integration`               |
| Security: token guessing, rate limits, XSS, uploads      | `integration/security.test.ts`                                                                                                  | `integration`               |
| Critical path 2: offline quote, restart, reconnect, send | `integration/offline-sync.test.ts` (the app's own outbox, store and API) and `apps/mobile/.maestro/02-offline-quote-syncs.yaml` | `integration`, `mobile-e2e` |
| Critical path 1: customer, quote, send, open, approve    | `portal/live.spec.ts` and `apps/mobile/.maestro/01-create-and-send-quote.yaml`                                                  | `integration`, `mobile-e2e` |
| Critical paths 1 (booking) and 3 (same slot, one winner) | `integration/scheduling.test.ts`: book a visit, same-slot race, refused bookings                                                | `integration`               |
| Customer portal states, validation, XSS rendering        | `portal/portal.spec.ts` (Edge Function stubbed)                                                                                 | `integration`               |

## Running locally

```bash
pnpm supabase:start                                   # Postgres, Auth, Storage, gateway
pnpm exec supabase functions serve --env-file <file>  # TOKEN_PEPPER=… and PUBLIC_APP_URL=http://localhost:3000
pnpm test:integration

# Portal E2E: build the web app against the local stack, then run Playwright.
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon key> pnpm --filter @q2c/web build
pnpm test:e2e
```

Connection settings come from `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, or from `supabase status` when unset. The suites sign in as the seeded users (`supabase/seed.sql`) with the test OTP in `supabase/config.toml`, and create their own quotes, jobs and invoices through the app's functions, so they can run repeatedly on one database. `tests/integration/jobs.test.ts` also signs up a brand-new owner with no seed data and walks the whole flow to a paid invoice.

Mobile flows need an Android emulator with the app installed and [Maestro](https://maestro.mobile.dev): `maestro test apps/mobile/.maestro`. Maestro types ASCII only on Android, so flow input is in English.
