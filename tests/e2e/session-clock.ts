import type {Page} from '@playwright/test';
import {createDatabase} from '../../packages/db/src/client.js';

// Advance just the selected server timer in the isolated Compose test database.
export async function ageOnlineSession(userId: string, sessionId: string) {
  if (
    process.env['E2E_RUN_MODE'] !== 'authenticated' ||
    !/^chronostasis-e2e-\d+$/.test(process.env['E2E_ISOLATED_PROJECT'] ?? '')
  )
    throw new Error(
      'The session clock fixture requires the isolated E2E runner.',
    );

  const db = createDatabase(
    'postgresql://chronostasis:chronostasis@db:5432/chronostasis',
  );
  try {
    // Lock in the same order as sync. The revision bump exposes the test clock change on refresh.
    const result = await db.orm.$client.query(
      `WITH owner AS MATERIALIZED (
        SELECT id FROM users WHERE id = $1::uuid FOR UPDATE
      ), aged AS (
        UPDATE focus_sessions AS session
        SET started_at = clock_timestamp() - (session.planned_duration_seconds + 1) * interval '1 second'
        FROM owner
        WHERE session.user_id = owner.id AND session.id = $2::uuid
          AND session.origin = 'online' AND session.status = 'running'
        RETURNING session.user_id
      )
      UPDATE users SET revision = revision + 1
      FROM aged WHERE users.id = aged.user_id`,
      [userId, sessionId],
    );
    if (result.rowCount !== 1)
      throw new Error('The authenticated online test timer was not found.');
  } finally {
    await db.close();
  }
}

// Age the authenticated test user's local timer without advancing Clerk's clock.
export async function ageOfflineSession(page: Page, userId: string) {
  await page.evaluate(async dbUserId => {
    const clerkUserId = window.Clerk.session?.user.id;
    if (!clerkUserId) throw new Error('The test has no active Clerk session.');
    const name = 'chronostasis-sync:' + clerkUserId;
    await navigator.locks.request(
      name + ':actions',
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open(name);
          open.onupgradeneeded = () => open.transaction?.abort();
          open.onerror = () => {
            reject(new Error('The account cache could not be opened.'));
          };
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('state', 'readwrite');
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onabort = () => {
              db.close();
              reject(
                new Error(
                  'The authenticated offline test timer was not found.',
                ),
              );
            };
            const store = tx.objectStore('state');
            const snapshot = store.get('snapshot');
            snapshot.onsuccess = () => {
              const cached = snapshot.result as
                {user?: {id: string}} | undefined;
              if (cached?.user?.id !== dbUserId) {
                tx.abort();
                return;
              }
              const timer = store.get('localSession');
              timer.onsuccess = () => {
                const local = timer.result as
                  | {
                      chestId: string;
                      sessionId: string;
                      plannedDurationSeconds: number;
                      startedAt: string;
                    }
                  | undefined;
                if (
                  local?.chestId !== 'basic-chest' ||
                  !local.sessionId ||
                  local.plannedDurationSeconds !== 900
                ) {
                  tx.abort();
                  return;
                }
                store.put(
                  {
                    ...local,
                    startedAt: new Date(Date.now() - 901_000).toISOString(),
                  },
                  'localSession',
                );
              };
            };
          };
        }),
    );
    window.dispatchEvent(new Event('focus'));
  }, userId);
}
