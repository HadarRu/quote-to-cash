// Regenerates .expo/types/router.d.ts (normally written by `expo start`) so that
// `pnpm typecheck` checks every href against the current routes, also in CI.
// Uses the same generator as the Expo CLI.
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '../app');
process.env.EXPO_ROUTER_APP_ROOT = appRoot;

const { requireContext } = require('expo-router/internal/testing');
const { EXPO_ROUTER_CTX_IGNORE } = require('expo-router/_ctx-shared');
const {
  getTypedRoutesDeclarationFile,
} = require('@expo/router-server/build/typed-routes/generate');

const outDir = path.resolve(__dirname, '../.expo/types');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'router.d.ts'),
  getTypedRoutesDeclarationFile(requireContext(appRoot, true, EXPO_ROUTER_CTX_IGNORE)),
);
