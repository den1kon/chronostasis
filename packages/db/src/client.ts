import {drizzle} from 'drizzle-orm/node-postgres';
import {sql} from 'drizzle-orm';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type {PoolConfig} from 'pg';
import {readDatabaseEnv} from './env.js';
import * as schema from './schema.js';

export function databasePoolOptions(connectionString: string): PoolConfig {
  const url = new URL(
    readDatabaseEnv({DATABASE_URL: connectionString}).databaseUrl,
  );
  const local = ['db', 'db-test', 'localhost', '127.0.0.1', '[::1]'].includes(
    url.hostname,
  );
  // pg's connection-string SSL parameters otherwise override explicit ssl options.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl'])
    url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    ssl: local ? false : {rejectUnauthorized: true},
  };
}

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool(databasePoolOptions(connectionString));
  pool.on('error', () => {
    console.error('An idle database connection failed.');
  });
  const orm = drizzle(pool, {schema});
  return {
    orm,
    async probe(): Promise<void> {
      await orm.execute(sql`select 1`);
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

export type DatabaseOperations = {orm: NodePgDatabase<typeof schema>};

export type Database = ReturnType<typeof createDatabase>;
