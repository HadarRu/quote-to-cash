import { defineConfig } from 'vitest/config';

// Unit tests of every workspace package in one run, for the merged coverage
// report (`pnpm coverage`). Each package still runs its own tests with `pnpm test`.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/web', 'apps/mobile', 'supabase/functions'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      include: [
        'packages/*/src/**/*.{ts,tsx}',
        'apps/web/src/**/*.{ts,tsx}',
        'apps/mobile/src/**/*.{ts,tsx}',
        'supabase/functions/**/*.ts',
      ],
      exclude: ['**/*.test.{ts,tsx}', '**/database.types.ts', '**/index.ts', '**/node-sql-db.ts'],
      // Business logic must stay covered; screens and native glue are covered by E2E.
      thresholds: {
        'packages/utils/src/**': { statements: 95, branches: 90, functions: 95, lines: 95 },
        'packages/types/src/**': { statements: 95, branches: 80, functions: 95, lines: 95 },
        'supabase/functions/**/handler.ts': {
          statements: 90,
          branches: 85,
          functions: 90,
          lines: 90,
        },
        'apps/mobile/src/quotes/{model,outbox,store,api}.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});
