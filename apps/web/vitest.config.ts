import { defineConfig } from 'vitest/config';

// Next compiles JSX itself (tsconfig "jsx": "preserve"); tests need the React runtime transform.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: { testTimeout: 60_000 },
});
