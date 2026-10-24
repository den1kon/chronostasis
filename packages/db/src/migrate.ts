import { createDatabase } from './client';
import { readDatabaseEnv } from './env';
import { migrateDatabase } from './migrations';

async function main(): Promise<void> {
  const database = createDatabase(readDatabaseEnv(process.env).migrationDatabaseUrl);
  try { await migrateDatabase(database); } finally { await database.close(); }
}

main().catch(() => {
  console.error('Database migration failed. Check DATABASE_URL/MIGRATION_DATABASE_URL and database availability.');
  process.exitCode = 1;
});
