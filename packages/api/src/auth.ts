import {verifyToken} from '@clerk/backend';
import type {ApiEnv} from './env';

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
    } catch {
      return null;
    }
  };
}
