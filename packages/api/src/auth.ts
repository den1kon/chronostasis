import {verifyToken} from '@clerk/backend';
import {AuthenticationUnavailableError} from './auth-error.js';
import type {ApiEnv} from './env.js';

const remoteKeyLoadFailure = 'jwk-remote-failed-to-load';
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
  'jwk-remote-invalid',
  'jwk-remote-missing',
  'jwk-failed-to-resolve',
  'jwk-kid-mismatch',
]);
const transportErrorCodes = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

// Clerk reports malformed JWTs with a reason and forwards bare JWKS fetch and JSON errors.
function jwksFailureReason(
  error: unknown,
  reason: unknown,
): string | undefined {
  if (reason === remoteKeyLoadFailure) return reason;
  if (reason !== undefined) return undefined;
  if (error instanceof SyntaxError) return 'jwks-invalid-json';
  if (!(error instanceof TypeError)) return undefined;
  const cause = error.cause;
  if (
    cause instanceof Error &&
    'code' in cause &&
    typeof cause.code === 'string' &&
    transportErrorCodes.has(cause.code)
  )
    return 'jwks-transport-failed';
  return undefined;
}

// Return a verified identity or null for rejected credentials. Throw if verification is unavailable.
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
    let claims: Awaited<ReturnType<typeof verifyToken>>;
    try {
      claims = await verifyToken(token, {
        secretKey: settings.clerkSecretKey,
        issuer: settings.clerkIssuer,
        authorizedParties: settings.authorizedParties,
      });
    } catch (error) {
      const reason =
        typeof error === 'object' && error !== null && 'reason' in error
          ? error.reason
          : undefined;
      // Emit only known categories: SDK messages and error objects can contain credentials.
      const unavailableReason = jwksFailureReason(error, reason);
      if (unavailableReason) {
        console.warn(
          'Clerk session verification unavailable',
          unavailableReason,
        );
        throw new AuthenticationUnavailableError();
      }
      console.warn(
        'Clerk session rejected',
        typeof reason === 'string' && verificationReasons.has(reason)
          ? reason
          : 'verification-failed',
      );
      return null;
    }
    if (
      typeof claims.sub !== 'string' ||
      !claims.sub.trim() ||
      typeof claims.sid !== 'string' ||
      !claims.sid.trim() ||
      claims.sts === 'pending'
    )
      return null;
    return {clerkUserId: claims.sub};
  };
}
