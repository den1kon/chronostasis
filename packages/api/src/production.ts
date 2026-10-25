import {
  createDatabase,
  createUserRepository,
  readDatabaseEnv,
} from '@chronostasis/db';
import {createAuthenticator} from './auth';
import {readApiEnv} from './env';
import {createApiHandler} from './handler';

export function createProductionApi(
  env: Readonly<Record<string, string | undefined>>,
) {
  const settings = readApiEnv(env);
  const database = createDatabase(readDatabaseEnv(env).databaseUrl);
  const repository = createUserRepository(database);
  const handler = createApiHandler({
    authenticate: createAuthenticator(settings),
    ensureUser: subject => repository.ensureUser(subject),
    findUser: subject => repository.findUser(subject),
    probe: () => database.probe(),
  });
  return {
    handler,
    close: () => database.close(),
    host: settings.host,
    port: settings.port,
  };
}
