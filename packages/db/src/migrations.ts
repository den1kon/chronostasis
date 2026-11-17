import {fileURLToPath} from 'node:url';
import {DrizzleQueryError} from 'drizzle-orm';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import type {DatabaseOperations} from './client.js';

export async function migrateDatabase(
  database: DatabaseOperations,
): Promise<void> {
  await migrate(database.orm, {
    migrationsFolder: fileURLToPath(new URL('../drizzle/', import.meta.url)),
  });
}

// Expose only fixed precondition messages, since driver errors can contain SQL or configuration details.
export function migrationPreconditionMessage(
  error: unknown,
): string | undefined {
  if (
    !(error instanceof DrizzleQueryError) ||
    !(error.cause instanceof pg.DatabaseError)
  )
    return undefined;
  switch (error.cause.code) {
    case 'P2401':
      return 'CHR-24 requires an empty focus_sessions table.';
    case 'P2402':
      return 'CHR-24 found inventory with unrecognized legacy provenance.';
    case 'P2403':
      return 'CHR-24 requires the creation-token catalogue ID to be unused.';
    default:
      return undefined;
  }
}
