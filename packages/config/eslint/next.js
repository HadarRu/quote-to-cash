import nextPlugin from '@next/eslint-plugin-next';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import react from './react.js';

/** React rules + Next.js (core web vitals). */
export default defineConfig(react, {
  plugins: { '@next/next': nextPlugin },
  languageOptions: { globals: { ...globals.browser } },
  rules: {
    ...nextPlugin.configs.recommended.rules,
    ...nextPlugin.configs['core-web-vitals'].rules,
  },
});
