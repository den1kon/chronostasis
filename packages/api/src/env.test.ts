import { describe, expect, it } from 'vitest';
import { readApiEnv } from './env';

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
    expect(readApiEnv({ ...valid, API_HOST: '0.0.0.0' }).host).toBe('0.0.0.0');
  });
  it.each(['CLERK_SECRET_KEY', 'CLERK_ISSUER', 'CLERK_AUTHORIZED_PARTIES'])('names missing %s without disclosing other settings', (name) => {
    const env = { ...valid, [name]: '' };
    expect(() => readApiEnv(env)).toThrow(name);
    try { readApiEnv(env); } catch (error) { expect(String(error)).not.toContain('private-fixture'); }
  });
  it.each(['http://example.clerk.accounts.dev', 'not-a-url', 'https://user:pw@example.com', 'https://example.com/path'])('rejects invalid Clerk issuers', (issuer) => {
    expect(() => readApiEnv({ ...valid, CLERK_ISSUER: issuer })).toThrow('CLERK_ISSUER');
  });
  it.each(['*', '', 'http://localhost:5173/path', 'http://user:pw@localhost:5173', 'http://localhost:5173,'])('rejects malformed or wildcard authorized parties', (parties) => {
    expect(() => readApiEnv({ ...valid, CLERK_AUTHORIZED_PARTIES: parties })).toThrow('CLERK_AUTHORIZED_PARTIES');
  });
  it.each(['0', '65536', '1.5', 'NaN'])('rejects invalid listener ports', (port) => {
    expect(() => readApiEnv({ ...valid, API_PORT: port })).toThrow('API_PORT');
  });
});
