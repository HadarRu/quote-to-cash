import { defineConfig } from 'eslint/config';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import base from './base.js';

/** Base rules + React. UI text must come from the i18n file, so JSX string literals are banned. */
export default defineConfig(
  base,
  {
    files: ['**/*.{jsx,tsx}'],
    extends: [react.configs.flat.recommended, react.configs.flat['jsx-runtime']],
    settings: { react: { version: 'detect' } },
    rules: {
      'react/prop-types': 'off',
      'react/jsx-no-literals': ['error', { noStrings: false, ignoreProps: true }],
    },
  },
  reactHooks.configs.flat['recommended-latest'],
);
