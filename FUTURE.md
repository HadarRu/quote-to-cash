# Future ideas

Ideas noted while building, intentionally **not** implemented yet.

- Lint rule banning physical-direction styles (`marginLeft`, `paddingRight`, `left`, `textAlign: 'left'`)
  in favour of logical ones (`marginStart`, `paddingInline`, `start`) to keep RTL correct by construction.
- Typed env validation (Zod schema in `packages/types`) for `SUPABASE_URL`, `PUBLIC_APP_URL`, etc., and
  wiring them into Next (`NEXT_PUBLIC_*`) and Expo (`EXPO_PUBLIC_*` / `app.config.ts` `extra`).
- Real app icon, splash screen and web favicon for the mobile app (`app.json` `icon` / `web.favicon`).
- Phone display formatter (`+972521234567` → `052-123-4567`) in `packages/utils`.
- Shared React Native component kit (Button, Card, Screen with loading/empty/error states) in `packages/ui`.
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
