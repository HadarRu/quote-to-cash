# Live demo

A demo anyone with the link can try: the app as a website (the Expo web build, which runs in a
phone's browser), the customer quote page, and a hosted Supabase project loaded with the seed
data. It is deployed by hand with the **Demo deploy** workflow
(`.github/workflows/demo-deploy.yml`); merging to `main` deploys nothing.

Everything runs on free plans: Supabase Free and Vercel Hobby.

## One-time setup

1. **Supabase:** create a free project (region `eu-central-1`, Frankfurt, is closest to Israel)
   and note its database password. The project ref is the `xxxx` in
   `https://supabase.com/dashboard/project/xxxx`. Create an access token at
   <https://supabase.com/dashboard/account/tokens>.
2. **Vercel:** create a free (Hobby) account and a token at
   <https://vercel.com/account/settings/tokens>. The workflow creates the two Vercel projects
   (`quote-to-cash-portal` and `quote-to-cash-app`) itself.
3. **GitHub:** in the repository, Settings → Secrets and variables → Actions → New repository
   secret, add:

   | Secret                  | Value                         |
   | ----------------------- | ----------------------------- |
   | `SUPABASE_ACCESS_TOKEN` | the Supabase access token     |
   | `SUPABASE_PROJECT_REF`  | the project ref               |
   | `SUPABASE_DB_PASSWORD`  | the project database password |
   | `VERCEL_TOKEN`          | the Vercel token              |

## Deploy

Actions → **Demo deploy** → Run workflow. The run summary lists the two links. Run it again after
new work is merged to update the demo; it is safe to repeat.

Each run:

- applies `supabase/migrations` and loads `supabase/seed.sql` (the seed only on the first run),
- pushes the auth settings in `supabase/config.toml`, including the test phone numbers,
- deploys every Edge Function, and sets `TOKEN_PEPPER` (once, randomly) and `PUBLIC_APP_URL`,
- builds the portal on Vercel and uploads the app's web export as a static site.

## Trying it

Sign in with a test number; no SMS is sent and the code is always `123456`:

| Number         | Who                                         |
| -------------- | ------------------------------------------- |
| `050-000-0001` | OWNER of business A (`כהן חשמל`)            |
| `050-000-0003` | OWNER of business B (`מזרחי חשמל`)          |
| `050-123-4567` | a new user, who goes through Business Setup |

Anyone with the link can sign in with these numbers and change the demo data, so keep only demo
data in this project. Real phone numbers cannot sign in (the SMS provider is a placeholder).

## Limits

- **Jobs:** until the Jobs stage lands, the app cannot create jobs, so invoicing works only on
  seeded jobs. Once it lands, the whole flow works from an empty account; run the workflow again.
- **Quote PDF:** the portal's PDF download needs a Chromium binary, which Vercel does not have,
  so it fails in the demo. The quote page itself works.
- **Push notifications** are off: they need an Expo project and the `notify` Vault secrets.
- The app runs in the browser, so camera photos use the browser's file picker.
