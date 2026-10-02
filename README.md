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
  utils/         Pure helpers (money in agorot, Israeli phone → E.164)
supabase/
  config.toml    Local Supabase stack (Supabase CLI)
  migrations/    SQL migrations: every DB change goes here
  functions/     Edge Functions
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

`supabase/seed.sql` creates two businesses (A and B), each with an OWNER and an EMPLOYEE, and one
row in every table. It is for local development and tests only and refuses to run on a database
that already has businesses. Never run it against production.

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
- `subscription` is read-only for members (written by the billing backend); `audit_log` is
  insert-only for everyone, including the table owner.

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

| Variable            | Used by                                         |
| ------------------- | ----------------------------------------------- |
| `SUPABASE_URL`      | apps, Edge Functions                            |
| `SUPABASE_ANON_KEY` | apps                                            |
| `TOKEN_PEPPER`      | Edge Functions only (server secret)             |
| `SENTRY_DSN`        | error reporting                                 |
| `POSTHOG_KEY`       | product analytics                               |
| `PUBLIC_APP_URL`    | absolute links sent to customers (web base URL) |

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
  The mobile web build sets `dir="rtl"` in `apps/mobile/app/+html.tsx`.
- The home screen of both apps shows the 7 flow steps; step 1 must render on the **right**.

## Design tokens

Defined once in `packages/ui/src/tokens.ts`: primary `#0F6B5C`, accent `#F59E0B`, 12px radius,
8px spacing grid, 48px minimum touch target, Heebo font, light and dark themes. The web app consumes
them as CSS variables generated by `themeCss()`; the mobile app imports them directly.
