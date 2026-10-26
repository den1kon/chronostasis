import {verifyToken} from '@clerk/backend';
import type {ApiEnv} from './env.js';

const verificationReasons = new Set([
  'token-expired',
  'token-invalid',
  'token-invalid-algorithm',
  'token-invalid-authorized-parties',
  'token-invalid-issuer',
  'token-invalid-signature',
  'token-not-active-yet',
  'token-iat-in-the-future',
  'token-verification-failed',
  'secret-key-invalid',
  'jwk-local-missing',
  'jwk-remote-failed-to-load',
  'jwk-remote-invalid',
  'jwk-remote-missing',
  'jwk-failed-to-resolve',
  'jwk-kid-mismatch',
]);

export function createAuthenticator(
  settings: Pick<
    ApiEnv,
    'clerkSecretKey' | 'clerkIssuer' | 'authorizedParties'
  >,
) {
  return async (request: Request): Promise<{clerkUserId: string} | null> => {
    const token = /^Bearer ([^\s]+)$/iu.exec(
      request.headers.get('authorization') ?? '',
    )?.[1];
    if (!token) return null;
    try {
      const claims = await verifyToken(token, {
        secretKey: settings.clerkSecretKey,
        issuer: settings.clerkIssuer,
        authorizedParties: settings.authorizedParties,
      });
      if (!claims.sub.trim() || !claims.sid.trim() || claims.sts === 'pending')
        return null;
      return {clerkUserId: claims.sub};
    } catch (error) {
      const reason =
        typeof error === 'object' && error !== null && 'reason' in error
          ? error.reason
          : undefined;
      // Emit only known categories: SDK messages and error objects can contain credentials.
      console.warn(
        'Clerk session rejected',
        typeof reason === 'string' && verificationReasons.has(reason)
          ? reason
          : 'verification-failed',
      );
      return null;
    }
  };
}
