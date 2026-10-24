import { createDatabase } from './client';
import { readDatabaseEnv } from './env';
import { seedCatalogue } from './seeding';

async function main(): Promise<void> {
  const database = createDatabase(readDatabaseEnv(process.env).databaseUrl);
  try { await seedCatalogue(database); } finally { await database.close(); }
}

main().catch(() => {
  console.error('Database seeding failed. Check DATABASE_URL and database availability.');
  process.exitCode = 1;
});
