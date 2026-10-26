import {describe, expect, it} from 'vitest';
import {readDeploymentEnv} from './deployment-env.mjs';

const integrationRuntime =
  'postgresql://app:secret@ep-integration-pooler.us-east-2.aws.neon.tech/chronostasis?sslmode=require';
const integrationDirect =
  'postgresql://app:secret@ep-integration.us-east-2.aws.neon.tech/chronostasis?sslmode=require';
const productionRuntime =
  'postgresql://app:secret@ep-production-pooler.us-east-2.aws.neon.tech/chronostasis?sslmode=require';
const productionDirect =
  'postgresql://app:secret@ep-production.us-east-2.aws.neon.tech/chronostasis?sslmode=require';

function previewEnv(
  branch = 'feature/new-thing',
): Record<string, string | undefined> {
  return {
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    VERCEL_GIT_COMMIT_REF: branch,
    NEON_POSTGRES_URL: integrationRuntime,
    NEON_POSTGRES_URL_NON_POOLING: integrationDirect,
    DEPLOYMENT_INTEGRATION_DB_HOST: 'ep-integration.us-east-2.aws.neon.tech',
    DEPLOYMENT_PRODUCTION_DB_HOST: 'ep-production.us-east-2.aws.neon.tech',
  };
}

describe('readDeploymentEnv', () => {
  it('uses the shared Integration database without preparing feature Previews', () => {
    expect(readDeploymentEnv(previewEnv())).toEqual({
      environment: 'preview',
      branch: 'feature/new-thing',
      databaseTarget: 'integration',
      prepareDatabase: false,
      databaseUrl: integrationRuntime,
      migrationDatabaseUrl: integrationDirect,
    });
  });

  it('prepares Integration only for the integration branch', () => {
    expect(readDeploymentEnv(previewEnv('integration'))).toMatchObject({
      databaseTarget: 'integration',
      prepareDatabase: true,
    });
  });

  it('maps Production to its own database and prepares it', () => {
    expect(
      readDeploymentEnv({
        VERCEL: '1',
        VERCEL_ENV: 'production',
        VERCEL_GIT_COMMIT_REF: 'main',
        NEON_POSTGRES_URL: productionRuntime,
        NEON_POSTGRES_URL_NON_POOLING: productionDirect,
        DEPLOYMENT_INTEGRATION_DB_HOST:
          'ep-integration.us-east-2.aws.neon.tech',
        DEPLOYMENT_PRODUCTION_DB_HOST: 'ep-production.us-east-2.aws.neon.tech',
      }),
    ).toMatchObject({
      environment: 'production',
      branch: 'main',
      databaseTarget: 'production',
      prepareDatabase: true,
      databaseUrl: productionRuntime,
      migrationDatabaseUrl: productionDirect,
    });
  });

  it('accepts the alternate complete Neon alias pair', () => {
    const env = previewEnv();
    delete env['NEON_POSTGRES_URL'];
    delete env['NEON_POSTGRES_URL_NON_POOLING'];
    env['NEON_DATABASE_URL'] = integrationRuntime;
    env['NEON_DATABASE_URL_UNPOOLED'] = integrationDirect;
    expect(readDeploymentEnv(env).databaseUrl).toBe(integrationRuntime);
  });

  it('accepts multiple alias pairs when they identify the same database', () => {
    expect(
      readDeploymentEnv({
        ...previewEnv(),
        NEON_DATABASE_URL: integrationRuntime,
        NEON_DATABASE_URL_UNPOOLED: integrationDirect,
      }).databaseTarget,
    ).toBe('integration');
  });

  it.each([
    {},
    {VERCEL: '0'},
    {VERCEL_ENV: 'development'},
    {VERCEL_GIT_COMMIT_REF: ''},
    {NEON_POSTGRES_URL: ''},
    {NEON_POSTGRES_URL_NON_POOLING: ''},
    {DEPLOYMENT_INTEGRATION_DB_HOST: ''},
    {DEPLOYMENT_PRODUCTION_DB_HOST: ''},
    {NEON_POSTGRES_URL: 'postgresql://app:secret@your-neon-host/db'},
    {DEPLOYMENT_INTEGRATION_DB_HOST: 'your-neon-host'},
    {
      DEPLOYMENT_INTEGRATION_DB_HOST:
        'https://ep-integration.us-east-2.aws.neon.tech',
    },
    {
      DEPLOYMENT_PRODUCTION_DB_HOST:
        'ep-production-pooler.us-east-2.aws.neon.tech',
    },
  ])('rejects missing or unsupported configuration (%j)', partial => {
    expect(() =>
      readDeploymentEnv(
        Object.keys(partial).length === 0
          ? partial
          : {...previewEnv(), ...partial},
      ),
    ).toThrow();
  });

  it('rejects incomplete or conflicting Neon alias pairs', () => {
    const incomplete = previewEnv();
    delete incomplete['NEON_POSTGRES_URL_NON_POOLING'];
    expect(() => readDeploymentEnv(incomplete)).toThrow();

    const conflicting = {
      ...previewEnv(),
      NEON_DATABASE_URL: productionRuntime,
      NEON_DATABASE_URL_UNPOOLED: productionDirect,
    };
    expect(() => readDeploymentEnv(conflicting)).toThrow();
  });

  it.each(['DATABASE_URL', 'MIGRATION_DATABASE_URL'])(
    'rejects hosted %s overrides',
    name => {
      expect(() =>
        readDeploymentEnv({...previewEnv(), [name]: integrationDirect}),
      ).toThrow();
    },
  );

  it.each([
    'postgresql://app:secret@localhost/chronostasis',
    'postgresql://app:secret@[::1]/chronostasis',
    'postgresql://app:secret@db.local/chronostasis',
    'postgresql://app:secret@ep-integration-pooler.us-east-2.aws.neon.tech/other',
    'postgresql://app:secret@ep-integration.us-east-2.aws.neon.tech:5544/chronostasis',
    'postgresql://app:secret@ep-different.us-east-2.aws.neon.tech/chronostasis',
    'postgresql://app:secret@ep-integration-pooler.us-east-2.aws.neon.tech/chronostasis?host=localhost',
  ])('rejects invalid Integration destinations safely', value => {
    expect(() =>
      readDeploymentEnv({
        ...previewEnv(),
        NEON_POSTGRES_URL_NON_POOLING: value,
      }),
    ).toThrow();
  });

  it('rejects a pooled migration endpoint and runtime/direct port mismatch', () => {
    const pooledMigration = previewEnv();
    pooledMigration['NEON_POSTGRES_URL_NON_POOLING'] = integrationRuntime;
    expect(() => readDeploymentEnv(pooledMigration)).toThrow();

    const differentPort = previewEnv();
    differentPort['NEON_POSTGRES_URL'] =
      'postgresql://app:secret@ep-integration-pooler.us-east-2.aws.neon.tech:5433/chronostasis';
    expect(() => readDeploymentEnv(differentPort)).toThrow();
  });

  it('rejects Production credentials in Preview', () => {
    expect(() =>
      readDeploymentEnv({
        ...previewEnv(),
        NEON_POSTGRES_URL: productionRuntime,
        NEON_POSTGRES_URL_NON_POOLING: productionDirect,
      }),
    ).toThrow();
  });

  it('keeps reserved path encodings distinct as pg does when selecting a database', () => {
    expect(() =>
      readDeploymentEnv({
        ...previewEnv(),
        NEON_POSTGRES_URL: integrationRuntime.replace(
          '/chronostasis',
          '/team/db',
        ),
        NEON_POSTGRES_URL_NON_POOLING: integrationDirect.replace(
          '/chronostasis',
          '/team%2Fdb',
        ),
      }),
    ).toThrow('must identify the same database');
  });

  it('rejects ambient PGPORT that would change an omitted migration port', () => {
    expect(() =>
      readDeploymentEnv({
        ...previewEnv(),
        PGPORT: '5433',
        NEON_POSTGRES_URL: integrationRuntime.replace('.tech/', '.tech:5432/'),
      }),
    ).toThrow('PGPORT');
  });

  it('does not disclose credentials in validation errors', () => {
    let message = '';
    try {
      readDeploymentEnv({
        ...previewEnv(),
        NEON_POSTGRES_URL: 'postgresql://user:top-secret@localhost/db',
      });
    } catch (error) {
      message = String(error);
    }
    expect(message).not.toContain('top-secret');
    expect(message).not.toContain('localhost');
  });
});
