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
- Supabase type generation (`supabase gen types typescript`) into `packages/types`.
