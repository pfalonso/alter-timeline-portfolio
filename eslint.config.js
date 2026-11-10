import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const noInfra = (layer) => ({
  patterns: [
    {
      group: ['three', 'three/*', '**/infrastructure/**'],
      message: `La capa ${layer} no puede depender de three ni de infrastructure.`,
    },
  ],
});
const noBrowserGlobals = ['window', 'document', 'fetch', 'localStorage', 'navigator', 'history', 'location'].map(
  (name) => ({ name, message: 'Dominio y aplicación no tocan APIs del navegador: usa un puerto.' }),
);

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'out'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Arquitectura hexagonal: las dependencias apuntan hacia dentro.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...noInfra('domain').patterns,
            { group: ['**/application/**'], message: 'El dominio no depende de la aplicación.' },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...noBrowserGlobals],
    },
  },
  {
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', noInfra('application')],
      'no-restricted-globals': ['error', ...noBrowserGlobals],
    },
  },
  {
    files: ['scripts/**', 'build/**', '*.config.ts', '*.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
