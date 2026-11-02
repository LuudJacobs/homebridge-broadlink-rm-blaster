// Flat config, replacing .eslintrc.cjs. ESLint 9 dropped eslintrc, so the
// upgrade to 10 came with the move.
//
// Flat config lints only *.js unless told otherwise, so every block below names
// the TypeScript files explicitly. `npm run lint` passes src and test as paths,
// and the ignores here keep the compiler output out of it.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'dist-test'],
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'quotes': ['warn', 'single'],
      'semi': ['warn'],
      '@typescript-eslint/no-unused-vars': ['warn'],
      '@typescript-eslint/no-explicit-any': ['off'],
    },
  },
);
