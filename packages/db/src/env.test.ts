import pg from 'pg';
import {describe, expect, it} from 'vitest';
import {databasePoolOptions} from './client';
import {readDatabaseEnv, readTestDatabaseUrl} from './env';

const development = 'postgresql://app:private-password@db:5432/chronostasis';
const isolated =
  'postgresql://test:private-password@db-test:5432/chronostasis_test';

describe('database configuration', () => {
  it('works without Clerk settings and falls back to the application URL for migrations', () => {
    expect(readDatabaseEnv({DATABASE_URL: development})).toEqual({
      databaseUrl: development,
      migrationDatabaseUrl: development,
    });
  });
  it('uses a separate direct migration URL when provided', () => {
    const direct =
      'postgresql://app:private-password@direct.example/chronostasis?sslmode=require';
    expect(
      readDatabaseEnv({
        DATABASE_URL: development,
        MIGRATION_DATABASE_URL: direct,
      }).migrationDatabaseUrl,
    ).toBe(direct);
  });
  it('treats an empty optional migration setting as absent', () => {
    expect(
      readDatabaseEnv({DATABASE_URL: development, MIGRATION_DATABASE_URL: '  '})
        .migrationDatabaseUrl,
    ).toBe(development);
  });
  it.each([
    undefined,
    '',
    'https://app:private-password@db/chronostasis',
    'not-private-password-a-url',
  ])(
    'rejects invalid application configuration without leaking its value',
    value => {
      expect(() => readDatabaseEnv({DATABASE_URL: value})).toThrow(
        'DATABASE_URL',
      );
      try {
        readDatabaseEnv({DATABASE_URL: value});
      } catch (error) {
        expect(String(error)).not.toContain('private-password');
      }
    },
  );
  it('rejects a malformed migration URL by variable name', () => {
    expect(() =>
      readDatabaseEnv({
        DATABASE_URL: development,
        MIGRATION_DATABASE_URL: 'secret-value',
      }),
    ).toThrow('MIGRATION_DATABASE_URL');
  });
  it('requires explicit isolated test settings', () => {
    expect(() => readTestDatabaseUrl({})).toThrow('TEST_DATABASE_URL');
    expect(readTestDatabaseUrl({TEST_DATABASE_URL: isolated})).toBe(isolated);
  });
  it.each([
    development,
    'postgresql://test:private-password@db:5432/chronostasis_test',
    'postgresql://test:private-password@remote.example/chronostasis_test',
  ])('refuses unsafe integration destinations: %s', value => {
    expect(() => readTestDatabaseUrl({TEST_DATABASE_URL: value})).toThrow(
      'isolated',
    );
  });
  it('refuses the application database even when its name looks like a test database', () => {
    expect(() =>
      readTestDatabaseUrl({
        TEST_DATABASE_URL: isolated,
        DATABASE_URL: isolated,
      }),
    ).toThrow('application database');
  });
  it('names invalid migration configuration correctly when validating a test destination', () => {
    expect(() =>
      readTestDatabaseUrl({
        TEST_DATABASE_URL: isolated,
        MIGRATION_DATABASE_URL: 'invalid-private-value',
      }),
    ).toThrow('MIGRATION_DATABASE_URL');
  });
  it('recognizes loopback aliases as the same database', () => {
    expect(() =>
      readTestDatabaseUrl({
        TEST_DATABASE_URL: 'postgresql://test:pw@127.0.0.1/chronostasis_test',
        DATABASE_URL: 'postgresql://app:other@localhost:5432/chronostasis_test',
      }),
    ).toThrow('application database');
  });
  it('enforces certificate verification for hosted connections despite insecure URL parameters', () => {
    const options = databasePoolOptions(
      'postgresql://app:pw@remote.example/app?sslmode=disable&sslrootcert=ignore',
    );
    expect(options.ssl).toEqual({rejectUnauthorized: true});
    expect(options.connectionString).not.toContain('sslmode');
    expect(options.connectionString).not.toContain('sslrootcert');
  });
  it.each(['host=remote.example', 'port=5433', '%68ost=remote.example'])(
    'rejects connection destination overrides: %s',
    query => {
      const value = `${isolated}?${query}`;
      expect(() => readTestDatabaseUrl({TEST_DATABASE_URL: value})).toThrow(
        'TEST_DATABASE_URL',
      );
      expect(() => databasePoolOptions(value)).toThrow('DATABASE_URL');
      expect(() =>
        readDatabaseEnv({
          DATABASE_URL: development,
          MIGRATION_DATABASE_URL: value,
        }),
      ).toThrow('MIGRATION_DATABASE_URL');
    },
  );
  it('keeps the validated authority as the effective pg destination', () => {
    const client = new pg.Client(
      databasePoolOptions(`${isolated}?application_name=chronostasis-test`),
    );
    expect(client.host).toBe('db-test');
    expect(client.port).toBe(5432);
    expect(client.database).toBe('chronostasis_test');
    expect(client.ssl).toBe(false);
  });
  it('supports the local Postgres service without requiring TLS', () => {
    expect(databasePoolOptions(development).ssl).toBe(false);
  });
});
