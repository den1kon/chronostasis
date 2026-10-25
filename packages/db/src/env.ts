type Environment = Readonly<Record<string, string | undefined>>;

function postgresUrl(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} must be a PostgreSQL connection URL.`);
  try {
    const parsed = new URL(trimmed);
    // pg query parameters can override the authority after URL validation.
    // Keep one source of truth for isolation checks and TLS classification.
    if (parsed.searchParams.has('host') || parsed.searchParams.has('port')) {
      throw new Error('Destination overrides are unsupported');
    }
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.pathname.length <= 1
    ) {
      throw new Error('Invalid URL');
    }
  } catch {
    // Never embed rejected configuration values: URLs can contain passwords.
    throw new Error(`${name} must be a PostgreSQL connection URL.`);
  }
  return trimmed;
}

function firstConfiguredUrl(env: Environment, names: readonly string[]) {
  for (const name of names) {
    if (env[name]?.trim()) return {value: env[name], name};
  }
  return {value: undefined, name: names.join(' or ')};
}

export function readDatabaseEnv(env: Environment) {
  const runtime = firstConfiguredUrl(env, [
    'DATABASE_URL',
    'NEON_DATABASE_URL',
  ]);
  const databaseUrl = postgresUrl(runtime.value, runtime.name);
  const migration = env['MIGRATION_DATABASE_URL']?.trim()
    ? firstConfiguredUrl(env, ['MIGRATION_DATABASE_URL'])
    : env['DATABASE_URL']?.trim()
      ? {value: databaseUrl, name: 'DATABASE_URL'}
      : firstConfiguredUrl(env, ['NEON_DATABASE_URL_UNPOOLED']);
  const migrationDatabaseUrl = migration.value
    ? postgresUrl(migration.value, migration.name)
    : databaseUrl;
  return {databaseUrl, migrationDatabaseUrl};
}

function destination(value: string): string {
  const url = new URL(value);
  const host = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    ? 'loopback'
    : url.hostname;
  return `${host}:${url.port || '5432'}${url.pathname}`;
}

export function readTestDatabaseUrl(env: Environment): string {
  const value = postgresUrl(env['TEST_DATABASE_URL'], 'TEST_DATABASE_URL');
  const parsed = new URL(value);
  if (
    !['db-test', 'localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
    parsed.pathname !== '/chronostasis_test'
  ) {
    throw new Error(
      'TEST_DATABASE_URL must point to an isolated local chronostasis_test database.',
    );
  }
  for (const name of [
    'DATABASE_URL',
    'MIGRATION_DATABASE_URL',
    'NEON_DATABASE_URL',
    'NEON_DATABASE_URL_UNPOOLED',
  ] as const) {
    const applicationUrl = env[name];
    if (
      applicationUrl?.trim() &&
      destination(postgresUrl(applicationUrl, name)) === destination(value)
    ) {
      throw new Error(
        'Integration tests must not use the application database.',
      );
    }
  }
  return value;
}
