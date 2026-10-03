# Future ideas

Ideas noted while building, intentionally **not** implemented yet.

- Lint rule banning physical-direction styles (`marginLeft`, `paddingRight`, `left`, `textAlign: 'left'`)
  in favour of logical ones (`marginStart`, `paddingInline`, `start`) to keep RTL correct by construction.
- Typed env validation (Zod schema in `packages/types`) for `SUPABASE_URL`, `PUBLIC_APP_URL`, etc., and
  wiring them into Next (`NEXT_PUBLIC_*`) and Expo (`EXPO_PUBLIC_*` / `app.config.ts` `extra`).
- Real app icon, splash screen and web favicon for the mobile app (`app.json` `icon` / `web.favicon`).
- Move the mobile component kit (`apps/mobile/src/components`) into `packages/ui` once the web app needs it.
- Turborepo remote cache in CI; EAS Build workflow for native binaries.
- Appointment overlap per assigned member (today a business cannot double-book at all, which fits a
  one-person business but not a team).
- Customer payment links for invoices (`token_hash` on `invoice`, like `quote`).
- Finer role permissions (e.g. EMPLOYEE cannot edit the service catalog, prices or settings).
- Storage bucket + Storage RLS policies matching `public.file` rows.
- Automatic audit triggers on business tables writing to `audit_log`.
- Lock issued invoices against edits (Israeli tax rules), with credit notes for corrections.
- Team invites by phone number (`business_member.status = 'invited'` before the user exists).
- Zod enum schemas derived from `Constants` in the generated database types.
- Store the session in the device keychain (expo-secure-store with an encrypted AsyncStorage
  payload) instead of plain AsyncStorage.
- Committed end-to-end tests (Playwright on the web build, Maestro on devices) for sign-up and
  setup, run in CI against `supabase start`.
- `deno check` of Edge Functions in CI.
- Edit business details and logo from Settings; show the logo on quotes.
- Server-side customer search (pg_trgm) for businesses with more than the 500 customers kept on the
  device.
- Offline writes: queue customer edits made without a connection and sync them later.
- Restore a soft-deleted customer; manage several addresses per customer from the form.
- Starter price lists for more trades (plumbers, HVAC, handymen) and a yearly price-update helper.
- Bulk price change (e.g. +5% for a category) and drag-to-reorder categories.
