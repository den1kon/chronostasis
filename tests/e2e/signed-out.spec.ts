import { expect, test } from '@playwright/test';

test('shows sign-in on a protected direct route and rejects unauthenticated API access', async ({ page, request }) => {
  const apiResponse = await request.get('/api/me');
  expect(apiResponse.status()).toBe(401);

  const navigationResponse = await page.goto('/inventory');
  expect(navigationResponse?.status()).toBe(200);
  await expect(page).toHaveURL(/\/sign-in\?/);
  await expect(page.getByRole('heading', { name: 'Sign in to Chronostasis' })).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions).toEqual({ viewportWidth: 390, documentWidth: 390 });
});
