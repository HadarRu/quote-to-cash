import { defineConfig } from 'vitest/config';

// Runs against the local Supabase stack. Files run one at a time: they share
// one database, and the public page's rate limits are global per window.
export default defineConfig({
  test: {
    include: ['integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
