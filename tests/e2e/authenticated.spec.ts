import { expect, test } from '@playwright/test';

function isMeResponse(response: { url(): string; request(): { method(): string } }, method: string): boolean {
  return new URL(response.url()).pathname === '/api/me' && response.request().method() === method;
}

test('initializes and reads the same persisted account through the authenticated API', async ({ page }) => {
  const postResponse = page.waitForResponse((response) => isMeResponse(response, 'POST'));
  const getResponse = page.waitForResponse((response) => isMeResponse(response, 'GET'));

  await page.goto('/');
  await expect(page.getByText('Account ready', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Make room for focus.' })).toBeVisible();

  const [post, get] = await Promise.all([postResponse, getResponse]);
  expect(post.status()).toBe(200);
  expect(get.status()).toBe(200);
  const initialized = (await post.json()) as { user: { id: string; clerkUserId: string } };
  const persisted = (await get.json()) as { user: { id: string; clerkUserId: string } };
  expect(initialized.user.id).toBe(persisted.user.id);
  expect(initialized.user.clerkUserId).toBe(persisted.user.clerkUserId);
});

test('retains the database user after reload and opens the inventory route on mobile', async ({ page }) => {
  const initialRead = page.waitForResponse((response) => isMeResponse(response, 'GET'));
  await page.goto('/');
  await expect(page.getByText('Account ready', { exact: true })).toBeVisible();
  const initialUser = (await (await initialRead).json()) as { user: { id: string } };

  const reloadRead = page.waitForResponse((response) => isMeResponse(response, 'GET'));
  await page.reload();
  await expect(page.getByText('Account ready', { exact: true })).toBeVisible();
  const reloadedUser = (await (await reloadRead).json()) as { user: { id: string } };
  expect(reloadedUser.user.id).toBe(initialUser.user.id);

  await page.goto('/inventory');
  await expect(page.getByRole('heading', { name: 'Your inventory' })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions).toEqual({ viewportWidth: 390, documentWidth: 390 });
});
