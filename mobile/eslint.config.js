// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    files: ["tests/**/*.cjs"],
    languageOptions: {
      globals: { __dirname: "readonly", Buffer: "readonly" },
    },
  },
]);
