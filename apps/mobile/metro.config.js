// Metro config: Expo defaults (monorepo-aware), plus the WebAssembly asset that
// expo-sqlite's web build loads.
/* eslint-disable @typescript-eslint/no-require-imports -- Metro loads this file as CommonJS. */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wasm');

module.exports = config;
