import {describe, expect, it} from 'vitest';
import {readApiEnv} from './env';

const valid = {
  CLERK_SECRET_KEY: 'sk_test_private-fixture',
  CLERK_ISSUER: 'https://example.clerk.accounts.dev',
  CLERK_AUTHORIZED_PARTIES: 'http://localhost:5173,http://localhost:5174',
};
describe('server configuration', () => {
  it('parses explicit issuer and frontend origins without requiring a browser key', () => {
    expect(readApiEnv(valid)).toEqual({
      clerkSecretKey: valid.CLERK_SECRET_KEY,
      clerkIssuer: valid.CLERK_ISSUER,
      authorizedParties: ['http://localhost:5173', 'http://localhost:5174'],
      host: '127.0.0.1',
      port: 3001,
    });
  });
  it('allows Compose to opt into its internal network interface', () => {
    expect(readApiEnv({...valid, API_HOST: '0.0.0.0'}).host).toBe('0.0.0.0');
  });
  it('allows the current Vercel deployment and branch URLs in Preview', () => {
    expect(
      readApiEnv({
        ...valid,
        VERCEL_ENV: 'preview',
        VERCEL_URL: 'chronostasis-abc123-denikon.vercel.app',
        VERCEL_BRANCH_URL: 'chronostasis-git-bugfix-chr-11-denikon.vercel.app',
      }).authorizedParties,
    ).toEqual([
      'http://localhost:5173',
      'http://localhost:5174',
      'https://chronostasis-abc123-denikon.vercel.app',
      'https://chronostasis-git-bugfix-chr-11-denikon.vercel.app',
    ]);
  });
  it('uses only Vercel URLs when Preview has no static origin list', () => {
    expect(
      readApiEnv({
        ...valid,
        CLERK_AUTHORIZED_PARTIES: undefined,
        VERCEL_ENV: 'preview',
        VERCEL_URL: 'chronostasis-abc123-denikon.vercel.app',
      }).authorizedParties,
    ).toEqual(['https://chronostasis-abc123-denikon.vercel.app']);
  });
  it('does not add Vercel URLs outside Preview', () => {
    expect(
      readApiEnv({
        ...valid,
        VERCEL_ENV: 'production',
        VERCEL_URL: 'chronostasis-abc123-denikon.vercel.app',
        VERCEL_BRANCH_URL: 'chronostasis-git-main-denikon.vercel.app',
      }).authorizedParties,
    ).toEqual(['http://localhost:5173', 'http://localhost:5174']);
  });
  it('requires Vercel system URLs in Preview', () => {
    expect(() => readApiEnv({...valid, VERCEL_ENV: 'preview'})).toThrow(
      'VERCEL_URL or VERCEL_BRANCH_URL',
    );
  });
  it('rejects malformed Vercel Preview URLs', () => {
    expect(() =>
      readApiEnv({
        ...valid,
        VERCEL_ENV: 'preview',
        VERCEL_URL: 'preview.example.com/path',
      }),
    ).toThrow('VERCEL_URL');
  });
  it.each(['CLERK_SECRET_KEY', 'CLERK_ISSUER', 'CLERK_AUTHORIZED_PARTIES'])(
    'names missing %s without disclosing other settings',
    name => {
      const env = {...valid, [name]: ''};
      expect(() => readApiEnv(env)).toThrow(name);
      try {
        readApiEnv(env);
      } catch (error) {
        expect(String(error)).not.toContain('private-fixture');
      }
    },
  );
  it.each([
    'http://example.clerk.accounts.dev',
    'not-a-url',
    'https://user:pw@example.com',
    'https://example.com/path',
  ])('rejects invalid Clerk issuers', issuer => {
    expect(() => readApiEnv({...valid, CLERK_ISSUER: issuer})).toThrow(
      'CLERK_ISSUER',
    );
  });
  it.each([
    '*',
    '',
    'http://localhost:5173/path',
    'http://user:pw@localhost:5173',
    'http://localhost:5173,',
  ])('rejects malformed or wildcard authorized parties', parties => {
    expect(() =>
      readApiEnv({...valid, CLERK_AUTHORIZED_PARTIES: parties}),
    ).toThrow('CLERK_AUTHORIZED_PARTIES');
  });
  it.each(['0', '65536', '1.5', 'NaN'])(
    'rejects invalid listener ports',
    port => {
      expect(() => readApiEnv({...valid, API_PORT: port})).toThrow('API_PORT');
    },
  );
});
