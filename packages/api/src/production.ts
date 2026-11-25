import {
  createDatabase,
  createSyncRepository,
  createUserRepository,
  readDatabaseEnv,
} from '../../db/src/index.js';
import {createAuthenticator} from './auth.js';
import {readApiEnv} from './env.js';
import {createApiHandler} from './handler.js';

export function createProductionApi(
  env: Readonly<Record<string, string | undefined>>,
) {
  const settings = readApiEnv(env);
  const database = createDatabase(readDatabaseEnv(env).databaseUrl);
  const repository = createUserRepository(database);
  const sync = createSyncRepository(database);
  const handler = createApiHandler({
    authenticate: createAuthenticator(settings),
    ensureUser: subject => repository.ensureUser(subject),
    findUser: subject => repository.findUser(subject),
    probe: () => database.probe(),
    getSnapshot: subject => sync.getSnapshot(subject),
    processOperation: (subject, operation) =>
      sync.processOperation(subject, operation),
  });
  return {
    handler,
    close: () => database.close(),
    host: settings.host,
    port: settings.port,
  };
}
