import {readDatabaseEnv} from './env.js';
import {prepareDatabase} from './preparation.js';

async function main(): Promise<void> {
  const {migrationDatabaseUrl} = readDatabaseEnv(process.env);
  console.log('Preparing database migrations and catalogue.');
  await prepareDatabase(migrationDatabaseUrl);
  console.log('Database preparation complete.');
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Database preparation failed.',
  );
  process.exitCode = 1;
});
