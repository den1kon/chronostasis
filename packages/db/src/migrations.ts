import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client';

export async function migrateDatabase(database: Database): Promise<void> {
  await migrate(database.orm, { migrationsFolder: fileURLToPath(new URL('../drizzle/', import.meta.url)) });
}
