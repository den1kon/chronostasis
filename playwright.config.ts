import {defineConfig, devices} from '@playwright/test';

const viewport = {width: 390, height: 844};
const authenticationState = '.superpowers/playwright/authenticated-state.json';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: '.superpowers/playwright-results',
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 45_000,
  expect: {timeout: 15_000},
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:5173',
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'signed-out',
      testMatch: 'signed-out.spec.ts',
      use: {...devices['Desktop Chrome'], viewport},
    },
    {
      name: 'auth-setup',
      testMatch: 'auth.setup.ts',
      use: {...devices['Desktop Chrome'], viewport},
    },
    {
      name: 'authenticated',
      testMatch: 'authenticated.spec.ts',
      dependencies: ['auth-setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport,
        storageState: authenticationState,
      },
    },
  ],
});
