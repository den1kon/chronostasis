import js from '@eslint/js';
import {defineConfig, globalIgnores} from 'eslint/config';
import gts from 'gts';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const gtsConfig = gts.map(config => {
  if (!config.plugins?.['@typescript-eslint']) return config;

  return {
    ...config,
    plugins: {...config.plugins, '@typescript-eslint': tseslint.plugin},
    languageOptions: {
      ...config.languageOptions,
      parser: tseslint.parser,
    },
  };
});

export default defineConfig(
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/playwright-report/**',
    '**/test-results/**',
    '.superpowers/**',
    '.vercel/**',
  ]),
  ...gtsConfig,
  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: {globals: globals.node},
  },
  {
    files: ['eslint.config.js'],
    languageOptions: {sourceType: 'module'},
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        project: null,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {globals: globals.browser},
    rules: {
      'no-restricted-globals': [
        'error',
        'process',
        'Buffer',
        'require',
        'module',
        'exports',
        '__dirname',
        '__filename',
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@chronostasis/db',
                '@chronostasis/db/**',
                '@chronostasis/api',
                '@chronostasis/api/**',
                '**/packages/db/**',
                '**/packages/api/**',
              ],
              message:
                'Browser code must use public contracts and HTTP, not server packages.',
            },
          ],
        },
      ],
    },
  },
);
