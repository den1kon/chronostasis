import {generateKeyPairSync, randomUUID, sign} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {createAuthenticator} from './auth';

const key = generateKeyPairSync('rsa', {modulusLength: 2048});
const otherKey = generateKeyPairSync('rsa', {modulusLength: 2048});
const kid = randomUUID();
const issuer = 'https://fixture.clerk.accounts.dev';
const party = 'http://localhost:5173';
const authenticate = createAuthenticator({
  clerkSecretKey: 'sk_test_fixture',
  clerkIssuer: issuer,
  authorizedParties: [party],
});
function token(
  override: Readonly<Record<string, unknown>> = {},
  privateKey = key.privateKey,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({alg: 'RS256', typ: 'JWT', kid}),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: issuer,
      sub: 'user_crypto',
      sid: 'sess_crypto',
      azp: party,
      iat: now - 5,
      nbf: now - 5,
      exp: now + 60,
      v: 2,
      ...override,
    }),
  ).toString('base64url');
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
}
const request = (value: string) =>
  new Request('http://localhost/api/me', {
    headers: {authorization: `Bearer ${value}`},
  });
beforeAll(() => {
  // Only Clerk's remote JWKS boundary is replaced; the real SDK verifies signatures/claims.
  const jwk = {
    ...key.publicKey.export({format: 'jwk'}),
    kid,
    alg: 'RS256',
    use: 'sig',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json({keys: [jwk]}))),
  );
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('real Clerk verifier with an isolated signing fixture', () => {
  it('accepts a correctly signed session for the configured instance and origin', async () => {
    expect(await authenticate(request(token()))).toEqual({
      clerkUserId: 'user_crypto',
    });
  });
  it.each([
    ['expired', {exp: 1}],
    ['not yet valid', {nbf: 4000000000}],
    ['wrong issuer', {iss: 'https://other.clerk.accounts.dev'}],
    ['wrong origin', {azp: 'https://other.example'}],
    ['missing origin', {azp: undefined}],
    ['pending session', {sts: 'pending'}],
  ])('rejects %s sessions', async (_name, override) => {
    expect(await authenticate(request(token(override)))).toBeNull();
  });
  it('rejects a signature from another key', async () => {
    expect(
      await authenticate(request(token({}, otherKey.privateKey))),
    ).toBeNull();
  });
});
