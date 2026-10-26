import {setTimeout as delay} from 'node:timers/promises';
import {drizzle} from 'drizzle-orm/node-postgres';
import pg from 'pg';
import {databasePoolOptions, type DatabaseOperations} from './client.js';
import {migrateDatabase} from './migrations.js';
import * as schema from './schema.js';
import {seedCatalogue} from './seeding.js';

const lockKey = [1128813105, 12] as const;
const defaultLockWaitMs = 60_000;
const lockPollIntervalMs = 250;

type PreparationOptions = {lockWaitMs?: number};

// Poll for a session lock with a bounded wait so concurrent deployments serialize
// preparation without leaving another build waiting indefinitely.
async function acquirePreparationLock(
  client: pg.Client,
  lockWaitMs: number,
): Promise<void> {
  const deadline = Date.now() + lockWaitMs;
  let acquired = false;
  while (!acquired) {
    const result = await client.query<{acquired: boolean}>(
      'select pg_try_advisory_lock($1, $2) as acquired',
      [...lockKey],
    );
    acquired = result.rows[0]?.acquired === true;
    if (!acquired) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Lock wait expired.');
      await delay(Math.min(lockPollIntervalMs, remaining));
    }
  }
}

// Hold one physical connection and session lock across migrations and seeding.
// Always release resources, preserving the original failure if cleanup also fails.
export async function prepareDatabase(
  connectionString: string,
  options: PreparationOptions = {},
): Promise<void> {
  const poolOptions = databasePoolOptions(connectionString);
  const client = new pg.Client({
    connectionString: poolOptions.connectionString,
    connectionTimeoutMillis: poolOptions.connectionTimeoutMillis,
    ssl: poolOptions.ssl,
  });
  const database: DatabaseOperations = {orm: drizzle(client, {schema})};
  const lockWaitMs = options.lockWaitMs ?? defaultLockWaitMs;
  let stage: 'connection' | 'lock' | 'migration' | 'seed' = 'connection';
  let locked = false;
  let failure: Error | undefined;

  try {
    await client.connect();
    stage = 'lock';
    await acquirePreparationLock(client, lockWaitMs);
    locked = true;
    stage = 'migration';
    await migrateDatabase(database);
    stage = 'seed';
    await seedCatalogue(database);
  } catch {
    failure = new Error(
      {
        connection: 'Database connection failed.',
        lock: 'Database preparation lock failed.',
        migration: 'Database migration failed.',
        seed: 'Database seed failed.',
      }[stage],
    );
  } finally {
    if (locked) {
      try {
        const result = await client.query<{unlocked: boolean}>(
          'select pg_advisory_unlock($1, $2) as unlocked',
          [...lockKey],
        );
        if (result.rows[0]?.unlocked !== true)
          failure ??= new Error('Database preparation lock release failed.');
      } catch {
        failure ??= new Error('Database preparation lock release failed.');
      }
    }
    try {
      await client.end();
    } catch {
      failure ??= new Error('Database connection close failed.');
    }
  }

  if (failure) throw failure;
}
