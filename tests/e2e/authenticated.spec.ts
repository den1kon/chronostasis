import {expect, test, type Page, type Response} from '@playwright/test';
import {
  SnapshotResponseSchema,
  SyncRequestSchema,
  SyncResponseSchema,
  type UserSnapshot,
} from '../../packages/contracts/src/sync.js';
import {ageOfflineSession, ageOnlineSession} from './session-clock';

function syncResponse(page: Page, method: 'GET' | 'POST') {
  return page.waitForResponse(
    response =>
      new URL(response.url()).pathname === '/api/sync' &&
      response.request().method() === method,
  );
}
async function snapshotResponse(response: Response) {
  expect(response.status()).toBe(200);
  return SnapshotResponseSchema.parse(await response.json());
}
async function syncedOperations(response: Response) {
  expect(response.status()).toBe(200);
  const {operations} = SyncRequestSchema.parse(
    response.request().postDataJSON(),
  );
  return {...SyncResponseSchema.parse(await response.json()), operations};
}
async function openFocus(page: Page): Promise<UserSnapshot> {
  const bootstrap = syncResponse(page, 'GET');
  await page.goto('/');
  await expect(page.getByText('Account ready', {exact: true})).toBeVisible();
  const response = await bootstrap;
  const headers = await response.request().allHeaders();
  expect(headers['authorization']?.startsWith('Bearer ')).toBe(true);
  const body = await snapshotResponse(response);
  if (body.unchanged) throw new Error('Expected a full account snapshot.');
  return body.snapshot;
}
async function assertMobileWidth(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions).toEqual({viewportWidth: 390, documentWidth: 390});
}

test('bootstraps an authenticated account and its one creation item', async ({
  page,
}) => {
  const snapshot = await openFocus(page);
  expect(Object.keys(snapshot.user).sort()).toEqual(['coins', 'id']);
  expect(snapshot.user.coins).toBe(0);
  expect(
    snapshot.items.filter(
      item => item.acquisitionSource === 'account_creation',
    ),
  ).toMatchObject([
    {itemId: 'creation-token', isVerified: true, sessionId: null},
  ]);
  await expect(
    page.getByRole('heading', {name: 'Make room for focus.'}),
  ).toBeVisible();
  await assertMobileWidth(page);
});

test('reuses the authenticated snapshot on reload and shows the creation item on mobile', async ({
  page,
}) => {
  const initial = await openFocus(page);
  const reloadRead = syncResponse(page, 'GET');
  await page.reload();
  await expect(page.getByText('Account ready', {exact: true})).toBeVisible();
  const refreshed = await reloadRead;
  const versions = new URL(refreshed.url()).searchParams;
  expect(versions.get('revision')).toBe(String(initial.revision));
  expect(versions.get('catalogueVersion')).toBe(initial.catalogueVersion);
  expect(await snapshotResponse(refreshed)).toEqual({
    unchanged: true,
    revision: initial.revision,
    catalogueVersion: initial.catalogueVersion,
  });

  await page.goto('/inventory');
  await expect(
    page.getByRole('heading', {name: 'Your inventory'}),
  ).toBeVisible();
  const creationItem = page
    .getByRole('listitem')
    .filter({hasText: 'Token of Creation'});
  await expect(creationItem).toHaveCount(1);
  await expect(creationItem.getByText('Verified', {exact: true})).toBeVisible();
  await assertMobileWidth(page);
});

test('unlocks the free chest offline, syncs an unverified reward, then starts and cancels online', async ({
  page,
  context,
}) => {
  const initial = await openFocus(page);
  await expect(page.getByText('0 coins', {exact: true})).toBeVisible();
  await expect(page.getByText('Free', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Start focus'})).toBeDisabled();

  await context.setOffline(true);
  await expect(page.getByText('Offline', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Unlock chest'}).click();
  await expect(page.getByText('Purchase pending', {exact: true})).toBeVisible();
  await page.getByLabel('Duration').selectOption('15');
  await page.getByRole('button', {name: 'Start focus'}).click();
  await expect(page.getByText('Offline session', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Claim reward'})).toBeDisabled();
  await ageOfflineSession(page, initial.user.id);
  await page.getByRole('button', {name: 'Claim reward'}).click();
  await expect(page.getByText('Pending sync', {exact: true})).toBeVisible();
  await page.getByRole('link', {name: 'Inventory'}).click();
  const offlineItem = page
    .getByRole('listitem')
    .filter({hasText: 'Unverified'});
  await expect(
    offlineItem.getByText('Pending sync', {exact: true}),
  ).toBeVisible();
  await assertMobileWidth(page);

  const response = syncResponse(page, 'POST');
  await context.setOffline(false);
  const accepted = await syncedOperations(await response);
  expect(accepted.operations.map(op => op.type)).toEqual([
    'buy_chest',
    'offline_session_claim',
  ]);
  expect(accepted.outcomes.map(outcome => outcome.status)).toEqual([
    'accepted',
    'accepted_unverified',
  ]);
  expect(accepted.snapshot.user.coins).toBe(0);
  expect(accepted.snapshot.userChests).toMatchObject([
    {chestId: 'basic-chest'},
  ]);
  expect(accepted.snapshot.sessions).toMatchObject([
    {origin: 'offline', status: 'completed'},
  ]);
  expect(
    accepted.snapshot.items.filter(
      item => item.acquisitionSource === 'offline_claim',
    ),
  ).toMatchObject([{isVerified: false}]);
  await expect(offlineItem).toBeVisible();
  await expect(
    offlineItem.getByText('Pending sync', {exact: true}),
  ).toHaveCount(0);

  await page.getByRole('link', {name: 'Focus'}).click();
  const startResponse = syncResponse(page, 'POST');
  await page.getByRole('button', {name: 'Start focus'}).click();
  const start = await syncedOperations(await startResponse);
  expect(start.outcomes).toMatchObject([
    {type: 'start_session', status: 'accepted'},
  ]);
  const sessionId = start.outcomes[0]?.sessionId;
  expect(sessionId).toBeTruthy();
  await expect(page.getByText('Online session', {exact: true})).toBeVisible();

  const cancelResponse = syncResponse(page, 'POST');
  await page.getByRole('button', {name: 'Cancel session'}).click();
  const cancellation = await syncedOperations(await cancelResponse);
  expect(cancellation.operations).toMatchObject([
    {type: 'cancel_session', sessionId},
  ]);
  expect(cancellation.outcomes).toMatchObject([{status: 'accepted'}]);
  expect(
    cancellation.snapshot.sessions.find(session => session.id === sessionId),
  ).toMatchObject({status: 'cancelled', origin: 'online'});
  await expect(page.getByRole('button', {name: 'Start focus'})).toBeEnabled();
});

test('queues an online session claim offline and receives one verified server reward on reconnect', async ({
  page,
  context,
}) => {
  const initial = await openFocus(page);
  if (!initial.userChests.some(unlock => unlock.chestId === 'basic-chest')) {
    const purchaseResponse = syncResponse(page, 'POST');
    await page.getByRole('button', {name: 'Unlock chest'}).click();
    expect(
      (await syncedOperations(await purchaseResponse)).outcomes,
    ).toMatchObject([{type: 'buy_chest', status: 'accepted'}]);
  }
  await page.getByLabel('Duration').selectOption('15');
  const startedResponse = syncResponse(page, 'POST');
  await page.getByRole('button', {name: 'Start focus'}).click();
  const started = await syncedOperations(await startedResponse);
  const sessionId = started.outcomes[0]?.sessionId;
  if (!sessionId) throw new Error('Expected a server-recorded online start.');
  expect(
    started.snapshot.sessions.find(session => session.id === sessionId),
  ).toMatchObject({
    origin: 'online',
    status: 'running',
    plannedDurationSeconds: 900,
  });
  const claim = page.getByRole('button', {name: 'Claim reward'});
  await expect(claim).toBeDisabled();
  await ageOnlineSession(initial.user.id, sessionId);
  const refreshed = syncResponse(page, 'GET');
  await page.getByRole('button', {name: 'Sync now'}).click();
  expect((await snapshotResponse(await refreshed)).unchanged).toBe(false);
  await expect(claim).toBeEnabled();

  await context.setOffline(true);
  await expect(page.getByText('Offline', {exact: true})).toBeVisible();
  await claim.click();
  await expect(page.getByText('Reward pending', {exact: true})).toBeVisible();
  await page.getByRole('link', {name: 'Inventory'}).click();
  await expect(page.getByRole('listitem')).toHaveCount(initial.items.length);

  const response = syncResponse(page, 'POST');
  await context.setOffline(false);
  const claimed = await syncedOperations(await response);
  expect(claimed.operations).toMatchObject([{type: 'claim_reward', sessionId}]);
  expect(claimed.outcomes).toMatchObject([{status: 'accepted'}]);
  expect(
    claimed.snapshot.items.filter(item => item.sessionId === sessionId),
  ).toMatchObject([{acquisitionSource: 'session_reward', isVerified: true}]);
  await expect(page.getByRole('listitem')).toHaveCount(
    initial.items.length + 1,
  );
  await expect(page.getByText('Verified', {exact: true})).toHaveCount(
    initial.items.filter(item => item.isVerified).length + 1,
  );
  await assertMobileWidth(page);
});
