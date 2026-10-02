# Quote-to-Cash

## Project

Quote-to-Cash Micro-SaaS for Israeli field tradespeople (electricians first). Hebrew, RTL, mobile-first. NOT a CRM.

**Flow:** Customer -> Quote -> Approval -> Scheduling -> Job -> Invoice -> Payment.

## Stack

- pnpm + Turborepo monorepo: `apps/mobile` (Expo RN), `apps/web` (Next.js), `packages/types|ui|config|utils`, `supabase/migrations|functions`.
- TypeScript strict.
- Supabase: Postgres + RLS, Phone OTP Auth, Storage, Edge Functions.
- Zod schemas in `packages/types` are the single source of truth.

## Conventions

- UUIDs (client-generated allowed).
- Money as integer agorot (`*_minor`).
- Timestamps in UTC; display in `Asia/Jerusalem`.
- Soft delete via `deleted_at`.
- Every business table has `business_id` + RLS via `app.is_member(business_id)`.
- Roles: `OWNER` / `ADMIN` / `EMPLOYEE` (UI exposes `OWNER` first).

## Rules

- Build only what each prompt asks.
- No duplicate code.
- No breaking existing APIs.
- No secrets in code (use env vars).
- Every DB change is a migration.
- Validate on client AND server.
- Every screen has loading/empty/error/success states.
- All UI strings in Hebrew via the i18n file (`packages/ui/src/i18n/he.ts`).
- Layout RTL.
- After finishing, run tests, typecheck, lint, build; fix all failures; then summarize files changed.
- Put extra ideas in `FUTURE.md`, not in code.

## Commands

Run from the repo root. CI (`.github/workflows/ci.yml`) runs the same commands, in this order.

```bash
pnpm install        # install all workspace dependencies (CI uses --frozen-lockfile)
pnpm format:check   # prettier --check .
pnpm typecheck      # turbo run typecheck
pnpm lint           # turbo run lint
pnpm test           # turbo run test (Vitest)
pnpm build          # turbo run build (next build + expo export)
```
