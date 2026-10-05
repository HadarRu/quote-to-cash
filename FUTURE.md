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
- Quotes: carry photos into a new revision (today a revision starts without the old photos).
- Quotes: "send the link again" from another device (rotate the customer token on request; today the
  link is shown only on the device that sent it).
- Quotes: pick the validity date in the editor (today it comes from `quote_valid_days`).
- Quotes: line reordering, per-line discounts, and templates of common quotes.
- Quotes: warn before signing out while the outbox still holds unsent changes.
- Quotes: copy photos taken offline into app storage on native instead of keeping them as base64 in
  SQLite.
- A scheduled job that marks open quotes EXPIRED in the database (the app derives it from the
  token expiry today).
- Customer page: notify the business (push / WhatsApp) when a quote is viewed, approved, rejected or
  commented on, and show customer comments in the app with replies.
- PDF: store the approved quote's PDF in Storage (`file.kind`) instead of rendering on every download,
  and package Chromium for the serverless host.
- A strict Content-Security-Policy with nonces for the web app.
- Rate limits keyed by a trusted client IP header from the host, and a separate budget for the PDF
  renderer (its page loads come from the server's address).
- Notifications: check Expo push receipts (delivery to Apple/Google, not just acceptance by Expo)
  and mark DELIVERED; quiet hours; a reminder hour per business instead of 18:00.
- Notifications: WhatsApp/SMS to customers (appointment reminder the day before), using the same
  queue with `channel = 'whatsapp'`.
- Notification inbox screen listing every push, not only the failed ones.
- Scheduling: let the owner reschedule or cancel a booked visit from the app (release the SELECTED
  time so the customer can pick again), notify the owner when the customer books, and a Calendar
  screen showing all visits (creating a visit there goes through a job, as Job detail does today).
- Jobs: assign a job to a team member from the app, put a job on hold and resume it, jobs without a
  quote (walk-in work), and a bottom tab bar (Home / Quotes / Jobs / Invoices) instead of the Home
  buttons.
- Invoicing providers that issue the legal document themselves (e.g. Green Invoice / Morning,
  iCount, EZcount), including Tax Authority allocation numbers.
- Partial payments and several payments per invoice (today "mark paid" records one payment for the
  full total).
- Credit notes for paid invoices (today a PAID invoice cannot be voided).
- Due dates on invoices with automatic payment reminders (today the owner sends each reminder).
- Store the invoice PDF from a provider in Storage (`file.kind = 'invoice_pdf'`).
- Tests: run the Maestro flows on iOS too, and one cross-device flow where the link the app sends is
  opened and approved in the browser.
