// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // React Compiler rules: the compiler is off (no experiments.reactCompiler), and these
    // misfire on refs read in event handlers and on Reanimated shared values.
    rules: { 'react-hooks/refs': 'off', 'react-hooks/immutability': 'off' },
  },
]);
