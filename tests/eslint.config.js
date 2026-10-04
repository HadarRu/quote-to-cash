import base from '@q2c/config/eslint/base';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig(base, globalIgnores(['test-results/**', 'playwright-report/**']));
