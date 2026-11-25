import {generateKeyPairSync, randomUUID, sign} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createAuthenticator} from './auth';
import {createApiHandler, type ApiDependencies} from './handler';

const key = generateKeyPairSync('rsa', {modulusLength: 2048});
const otherKey = generateKeyPairSync('rsa', {modulusLength: 2048});
const kid = randomUUID();
const issuer = 'https://fixture.clerk.accounts.dev';
const party = 'http://localhost:5173';
const settings = {
  clerkSecretKey: 'sk_test_fixture',
  clerkIssuer: issuer,
  authorizedParties: [party],
};
const authenticate = createAuthenticator(settings);
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
const request = (value: string, path = '/api/sync', method = 'GET') =>
  new Request(`http://localhost${path}`, {
    method,
    headers: {authorization: `Bearer ${value}`},
    ...(method === 'POST'
      ? {
          body: JSON.stringify({
            operations: [
              {
                operationId: '8d911870-547e-4edf-ae20-a78e78d8b14c',
                type: 'buy_chest',
                chestId: 'basic-chest',
              },
            ],
          }),
        }
      : {}),
  });

function setup(auth = authenticate) {
  const persistence = {
    ensureUser: vi.fn<ApiDependencies['ensureUser']>(),
    findUser: vi.fn<ApiDependencies['findUser']>(),
    probe: vi.fn<ApiDependencies['probe']>(),
    getSnapshot: vi.fn<ApiDependencies['getSnapshot']>(),
    processOperation: vi.fn<ApiDependencies['processOperation']>(),
  };
  return {
    persistence,
    handler: createApiHandler({authenticate: auth, ...persistence}),
  };
}

const jwksFailures = {
  'JSON 503': () =>
    Promise.resolve(
      Response.json(
        {errors: [{message: 'private upstream details'}]},
        {status: 503},
      ),
    ),
  'HTML 503': () =>
    Promise.resolve(
      new Response('<html>Service unavailable</html>', {status: 503}),
    ),
  'truncated JSON': () =>
    Promise.resolve(
      new Response('{"keys": [', {
        headers: {'Content-Type': 'application/json'},
      }),
    ),
  'connection reset': () => {
    const cause = Object.assign(new Error('private connection details'), {
      code: 'ECONNRESET',
    });
    return Promise.reject(new TypeError('fetch failed', {cause}));
  },
};

beforeEach(() => {
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
    ['missing session identifier', {sid: undefined}],
    ['non-string session identifier', {sid: 1}],
    ['pending session', {sts: 'pending'}],
  ])('rejects %s sessions', async (_name, override) => {
    const {handler, persistence} = setup();
    const response = await handler(request(token(override)));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {code: 'UNAUTHORIZED', message: 'Authentication required'},
    });
    for (const call of Object.values(persistence))
      expect(call).not.toHaveBeenCalled();
  });
  it('rejects a signature from another key', async () => {
    const {handler, persistence} = setup();
    const response = await handler(request(token({}, otherKey.privateKey)));
    expect(response.status).toBe(401);
    for (const call of Object.values(persistence))
      expect(call).not.toHaveBeenCalled();
  });
  it.each([
    ['header', 0],
    ['payload', 1],
  ])(
    'rejects malformed JWT %s JSON without fetching keys',
    async (_part, index) => {
      const parts = token().split('.');
      parts[index] = Buffer.from('{').toString('base64url');
      const {handler, persistence} = setup();
      const response = await handler(request(parts.join('.')));
      expect(response.status).toBe(401);
      expect(fetch).not.toHaveBeenCalled();
      for (const call of Object.values(persistence))
        expect(call).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['/api/sync', 'GET', 'JSON 503'],
    ['/api/sync', 'POST', 'JSON 503'],
    ['/api/me', 'GET', 'JSON 503'],
    ['/api/me', 'POST', 'JSON 503'],
    ['/api/sync', 'POST', 'connection reset'],
    ['/api/sync', 'POST', 'HTML 503'],
    ['/api/sync', 'POST', 'truncated JSON'],
  ] as const)(
    'returns 503 without persistence access to %s %s after %s',
    async (path, method, failure) => {
      vi.useFakeTimers({toFake: ['setTimeout']});
      vi.mocked(fetch).mockImplementation(jwksFailures[failure]);
      const {handler, persistence} = setup(
        createAuthenticator({
          ...settings,
          // Clerk caches JWKS by secret key. Use a fresh scope to force remote retrieval.
          clerkSecretKey: `sk_test_fixture_${randomUUID()}`,
        }),
      );
      const result = handler(request(token(), path, method));
      await vi.runAllTimersAsync();
      const response = await result;
      expect(fetch).toHaveBeenCalled();
      for (const call of Object.values(persistence))
        expect(call).not.toHaveBeenCalled();
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({
        error: {code: 'UNAVAILABLE', message: 'Service unavailable'},
      });
    },
  );
});
