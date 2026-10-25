import {configDefaults, defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'apps/**/*.test.{ts,tsx}',
      'packages/**/*.test.{ts,tsx}',
      'scripts/**/*.test.ts',
    ],
    exclude: [...configDefaults.exclude, '**/*.integration.test.{ts,tsx}'],
    passWithNoTests: false,
  },
});
