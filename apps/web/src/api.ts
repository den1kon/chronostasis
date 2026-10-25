import {UserResponseSchema, type PublicUser} from '@chronostasis/contracts';

type ErrorCode =
  'UNAUTHORIZED' | 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'REQUEST_FAILED';
const messages: Record<ErrorCode, string> = {
  UNAUTHORIZED: 'Your session needs to be refreshed. Please sign in again.',
  NETWORK_ERROR: 'Could not reach the server. Please try again.',
  INVALID_RESPONSE: 'The server returned an unexpected response.',
  REQUEST_FAILED: 'Could not sync your account. Please try again.',
};
export class ApiClientError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  constructor(code: ErrorCode, retryable = false) {
    super(messages[code]);
    this.name = 'ApiClientError';
    this.code = code;
    this.retryable = retryable;
  }
}
async function requestUser(
  method: 'GET' | 'POST',
  token: string,
  signal?: AbortSignal,
): Promise<PublicUser> {
  if (!token.trim()) throw new ApiClientError('UNAUTHORIZED');
  let response: Response;
  try {
    response = await fetch('/api/me', {
      method,
      headers: {Accept: 'application/json', Authorization: `Bearer ${token}`},
      ...(signal ? {signal} : {}),
    });
  } catch {
    throw new ApiClientError('NETWORK_ERROR', true);
  }
  if (response.status === 401) throw new ApiClientError('UNAUTHORIZED');
  if (!response.ok)
    throw new ApiClientError('REQUEST_FAILED', response.status >= 500);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiClientError('INVALID_RESPONSE');
  }
  const result = UserResponseSchema.safeParse(body);
  if (!result.success) throw new ApiClientError('INVALID_RESPONSE');
  return result.data.user;
}
export function initializeUser(
  token: string,
  signal?: AbortSignal,
): Promise<PublicUser> {
  return requestUser('POST', token, signal);
}
export function getCurrentUser(
  token: string,
  signal?: AbortSignal,
): Promise<PublicUser> {
  return requestUser('GET', token, signal);
}
