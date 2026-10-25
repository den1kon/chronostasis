import {
  clerk,
  clerkSetup,
  setupClerkTestingToken,
} from '@clerk/testing/playwright';
import {expect, test as setup} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';

const authenticationState = '.superpowers/playwright/authenticated-state.json';

setup('create a real Clerk development session', async ({page}) => {
  const publishableKey = process.env['VITE_CLERK_PUBLISHABLE_KEY'];
  const secretKey = process.env['CLERK_SECRET_KEY'];
  if (!publishableKey || !secretKey)
    throw new Error('Missing Clerk test configuration.');

  await clerkSetup({
    publishableKey,
    secretKey,
    dotenv: false,
  });
  await setupClerkTestingToken({page});
  await page.goto('/sign-in');
  await clerk.signIn({
    page,
    emailAddress: process.env['E2E_CLERK_USER_EMAIL'] ?? '',
  });
  await page.goto('/');
  await expect(page.getByText('Account ready', {exact: true})).toBeVisible();
  await mkdir(dirname(authenticationState), {recursive: true});
  await page.context().storageState({path: authenticationState});
});
