import {isIP} from 'node:net';

const DATABASE_PAIRS = [
  ['NEON_POSTGRES_URL', 'NEON_POSTGRES_URL_NON_POOLING'],
  ['NEON_DATABASE_URL', 'NEON_DATABASE_URL_UNPOOLED'],
];

const PLACEHOLDER =
  /(?:<[^>]+>|placeholder|your[-_ ]|change[-_ ]?me|example)/iu;

function fail(message) {
  throw new Error(message);
}

// Validate the URL without exposing credentials in errors; reject query parameters
// that could make pg connect somewhere other than the validated authority.
function readUrl(value, name) {
  if (!value?.trim()) fail(`${name} must be a PostgreSQL connection URL.`);
  try {
    const url = new URL(value.trim());
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length <= 1 ||
      PLACEHOLDER.test(url.hostname) ||
      url.searchParams.has('host') ||
      url.searchParams.has('port')
    ) {
      fail(
        `${name} must be a PostgreSQL connection URL without destination overrides.`,
      );
    }
    const databaseName = decodeURI(url.pathname.slice(1));
    if (PLACEHOLDER.test(databaseName)) {
      fail(`${name} must identify a configured PostgreSQL database.`);
    }
    return url;
  } catch {
    fail(`${name} must be a valid PostgreSQL connection URL.`);
  }
}

function normalizedHost(host) {
  return host.toLowerCase().replace(/\.$/u, '');
}

// Hosted Neon connections must use public DNS names; reject IP literals,
// single-label hosts, and reserved local/development domains.
function isLocalHost(host) {
  const value = normalizedHost(host);
  const ip =
    value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  return (
    value === 'localhost' ||
    value.endsWith('.localhost') ||
    value.endsWith('.local') ||
    value.endsWith('.internal') ||
    value.endsWith('.test') ||
    value.endsWith('.invalid') ||
    value === 'host.docker.internal' ||
    value.split('.').length < 2 ||
    isIP(ip) !== 0
  );
}

// Neon identifies pooled and direct connections with the same endpoint name,
// adding only a trailing -pooler to the first DNS label for pooling.
function directHost(host) {
  const labels = normalizedHost(host).split('.');
  labels[0] = labels[0].replace(/-pooler$/u, '');
  return labels.join('.');
}

// Compare exact endpoints using pg's decodeURI behavior for database names,
// which preserves encodings of reserved characters such as %2F.
function destination(url) {
  return `${normalizedHost(url.hostname)}:${url.port || '5432'}:${decodeURI(url.pathname.slice(1))}`;
}

// Treat pooled and direct endpoints as one database while retaining the port
// and decoded database name so a matching hostname cannot hide a mismatch.
function databaseIdentity(url) {
  return `${directHost(url.hostname)}:${url.port || '5432'}:${decodeURI(url.pathname.slice(1))}`;
}

// Read the owner's expected direct endpoint hostname, which guards against
// accidentally connecting a deployment to the other environment's database.
function readMarker(env, name) {
  const value = env[name]?.trim();
  if (!value || /[/:?#@\s]/u.test(value))
    fail(`${name} must be a direct Neon endpoint hostname.`);
  const host = normalizedHost(value);
  if (
    isLocalHost(host) ||
    host.includes('-pooler') ||
    PLACEHOLDER.test(host) ||
    !host
      .split('.')
      .every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label))
  ) {
    fail(`${name} must be a direct Neon endpoint hostname.`);
  }
  return host;
}

// Validate hosted credentials against the expected environment before any child
// starts, then decide whether this deployment may prepare its database.
export function readDeploymentEnv(env) {
  if (env['VERCEL'] !== '1')
    fail('Deployment must run in the Vercel build environment.');
  const environment = env['VERCEL_ENV'];
  if (environment !== 'preview' && environment !== 'production') {
    fail('VERCEL_ENV must be preview or production.');
  }
  const branch = env['VERCEL_GIT_COMMIT_REF']?.trim();
  if (!branch) fail('VERCEL_GIT_COMMIT_REF is required.');

  // pg falls back to PGPORT when a URL omits its port, defeating the validated
  // default of 5432 if an old unprefixed value remains in the environment.
  for (const name of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'PGPORT']) {
    if (env[name]?.trim())
      fail(`${name} is not allowed in hosted deployment configuration.`);
  }

  const configuredPairs = DATABASE_PAIRS.filter(([runtimeName, directName]) => {
    const hasRuntime = Boolean(env[runtimeName]?.trim());
    const hasDirect = Boolean(env[directName]?.trim());
    if (hasRuntime !== hasDirect) {
      fail(`${runtimeName} and ${directName} must be configured together.`);
    }
    return hasRuntime;
  });
  if (configuredPairs.length === 0) {
    fail('A complete supported Neon connection URL pair is required.');
  }

  const pairs = configuredPairs.map(([runtimeName, directName]) => {
    const runtimeUrl = readUrl(env[runtimeName], runtimeName);
    const migrationUrl = readUrl(env[directName], directName);
    if (
      isLocalHost(runtimeUrl.hostname) ||
      isLocalHost(migrationUrl.hostname)
    ) {
      fail('Hosted database URLs cannot use a local host.');
    }
    if (migrationUrl.hostname.toLowerCase().split('.')[0].endsWith('-pooler')) {
      fail(`${directName} must use a direct, non-pooled endpoint.`);
    }
    if (databaseIdentity(runtimeUrl) !== databaseIdentity(migrationUrl)) {
      fail(
        `${runtimeName} and ${directName} must identify the same database and port.`,
      );
    }
    return {
      runtimeName,
      directName,
      databaseUrl: env[runtimeName].trim(),
      migrationDatabaseUrl: env[directName].trim(),
      runtimeUrl,
      migrationUrl,
    };
  });

  const selected = pairs[0];
  for (const pair of pairs.slice(1)) {
    if (
      databaseIdentity(pair.runtimeUrl) !==
        databaseIdentity(selected.runtimeUrl) ||
      destination(pair.migrationUrl) !== destination(selected.migrationUrl)
    ) {
      fail(
        'Configured Neon connection URL pairs identify different databases.',
      );
    }
  }

  const productionHost = readMarker(env, 'DEPLOYMENT_PRODUCTION_DB_HOST');
  const integrationHost = readMarker(env, 'DEPLOYMENT_INTEGRATION_DB_HOST');
  if (productionHost === integrationHost) {
    fail('Production and Integration database host markers must be different.');
  }

  const databaseTarget =
    environment === 'production' ? 'production' : 'integration';
  const expectedHost =
    databaseTarget === 'production' ? productionHost : integrationHost;
  if (normalizedHost(selected.migrationUrl.hostname) !== expectedHost) {
    fail(
      `Configured Neon database does not match the ${databaseTarget} target marker.`,
    );
  }

  return {
    environment,
    branch,
    databaseTarget,
    prepareDatabase: environment === 'production' || branch === 'integration',
    databaseUrl: selected.databaseUrl,
    migrationDatabaseUrl: selected.migrationDatabaseUrl,
  };
}
