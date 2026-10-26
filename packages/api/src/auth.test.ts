import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {verifyToken} from '@clerk/backend';
import {createAuthenticator} from './auth';

vi.mock('@clerk/backend', () => ({verifyToken: vi.fn()}));
const options = {
  clerkSecretKey: 'sk_test_fixture',
  clerkIssuer: 'https://example.clerk.accounts.dev',
  authorizedParties: ['http://localhost:5173'],
};
const claims = {
  __raw: 'fixture',
  sub: 'user_verified',
  sid: 'sess_fixture',
  iss: options.clerkIssuer,
  azp: 'http://localhost:5173',
  exp: 2000000000,
  iat: 1900000000,
  nbf: 1900000000,
  v: 2 as const,
};
const request = (authorization?: string) =>
  new Request('http://localhost/api/me', {
    headers: authorization === undefined ? {} : {authorization},
  });
const authenticate = createAuthenticator(options);

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
describe('Clerk session verification', () => {
  it('logs a recognized verification category without error details', async () => {
    vi.mocked(verifyToken).mockRejectedValue(
      Object.assign(new Error('private token and key details'), {
        reason: 'secret-key-invalid',
        token: 'private-token',
      }),
    );
    expect(await authenticate(request('Bearer private-token'))).toBeNull();
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(
      'Clerk session rejected',
      'secret-key-invalid',
    );
  });
  it('replaces arbitrary verification reasons with a fixed category', async () => {
    vi.mocked(verifyToken).mockRejectedValue({reason: 'private-token'});
    expect(await authenticate(request('Bearer private-token'))).toBeNull();
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(
      'Clerk session rejected',
      'verification-failed',
    );
  });
  it.each([undefined, '', 'Basic abc', 'Bearer ', 'Bearer a b'])(
    'rejects missing or malformed bearer credentials',
    async header => {
      expect(await authenticate(request(header))).toBeNull();
      expect(verifyToken).not.toHaveBeenCalled();
    },
  );
  it.each([
    'expired',
    'invalid signature',
    'wrong issuer',
    'wrong authorized party',
  ])('rejects SDK verification failure: %s', async reason => {
    vi.mocked(verifyToken).mockRejectedValue(new Error(reason));
    expect(await authenticate(request('Bearer invalid'))).toBeNull();
    expect(verifyToken).toHaveBeenCalledWith('invalid', {
      secretKey: options.clerkSecretKey,
      issuer: options.clerkIssuer,
      authorizedParties: options.authorizedParties,
    });
  });
  it('returns only the verified subject and configures instance/origin verification', async () => {
    vi.mocked(verifyToken).mockResolvedValue(claims);
    expect(await authenticate(request('Bearer valid'))).toEqual({
      clerkUserId: 'user_verified',
    });
    expect(verifyToken).toHaveBeenCalledWith('valid', {
      secretKey: options.clerkSecretKey,
      issuer: options.clerkIssuer,
      authorizedParties: options.authorizedParties,
    });
  });
  it('rejects a pending session', async () => {
    vi.mocked(verifyToken).mockResolvedValue({...claims, sts: 'pending'});
    expect(await authenticate(request('Bearer valid'))).toBeNull();
  });
  it('rejects tokens without a session or usable subject', async () => {
    for (const override of [{sub: ''}, {sid: ''}]) {
      vi.mocked(verifyToken).mockResolvedValue({...claims, ...override});
      expect(await authenticate(request('Bearer valid'))).toBeNull();
    }
  });
});
