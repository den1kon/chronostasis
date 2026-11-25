import {
  SnapshotResponseSchema,
  SyncResponseSchema,
  UserResponseSchema,
  type SnapshotResponse,
  type SyncOperation,
  type SyncResponse,
  type UserSnapshot,
  type PublicUser,
} from '@chronostasis/contracts';
import {withSyncDeadline} from './sync-deadline';

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
async function requestJson(
  url: string,
  method: 'GET' | 'POST',
  token: string,
  signal?: AbortSignal,
  json?: string,
): Promise<unknown> {
  if (!token.trim()) throw new ApiClientError('UNAUTHORIZED');
  try {
    return await withSyncDeadline(async requestSignal => {
      const response = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(json === undefined ? {} : {'Content-Type': 'application/json'}),
        },
        ...(json === undefined ? {} : {body: json}),
        signal: requestSignal,
      });
      if (response.status === 401) throw new ApiClientError('UNAUTHORIZED');
      if (!response.ok)
        throw new ApiClientError('REQUEST_FAILED', response.status >= 500);
      try {
        return (await response.json()) as unknown;
      } catch (error) {
        if (error instanceof SyntaxError)
          throw new ApiClientError('INVALID_RESPONSE');
        throw error;
      }
    }, signal);
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    throw new ApiClientError('NETWORK_ERROR', true);
  }
}
async function requestUser(
  method: 'GET' | 'POST',
  token: string,
  signal?: AbortSignal,
): Promise<PublicUser> {
  const result = UserResponseSchema.safeParse(
    await requestJson('/api/me', method, token, signal),
  );
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

type Versions = Pick<UserSnapshot, 'revision' | 'catalogueVersion'>;

// An unchanged response can only authorize reuse of the exact requested cache.
export async function getSyncSnapshot(
  token: string,
  signal?: AbortSignal,
  known?: Versions,
): Promise<SnapshotResponse> {
  const query = known
    ? '?' +
      new URLSearchParams({
        revision: String(known.revision),
        catalogueVersion: known.catalogueVersion,
      }).toString()
    : '';
  const parsed = SnapshotResponseSchema.safeParse(
    await requestJson('/api/sync' + query, 'GET', token, signal),
  );
  if (
    !parsed.success ||
    (parsed.data.unchanged &&
      (known?.revision !== parsed.data.revision ||
        known.catalogueVersion !== parsed.data.catalogueVersion))
  )
    throw new ApiClientError('INVALID_RESPONSE');
  return parsed.data;
}

// Validate every correlation before the storage layer can acknowledge the batch.
export async function postSyncOperations(
  token: string,
  operations: SyncOperation[],
  signal?: AbortSignal,
): Promise<SyncResponse> {
  const parsed = SyncResponseSchema.safeParse(
    await requestJson(
      '/api/sync',
      'POST',
      token,
      signal,
      JSON.stringify({operations}),
    ),
  );
  if (
    !parsed.success ||
    parsed.data.outcomes.length !== operations.length ||
    parsed.data.outcomes.some(
      (outcome, i) =>
        outcome.operationId !== operations[i]?.operationId ||
        outcome.type !== operations[i].type,
    )
  )
    throw new ApiClientError('INVALID_RESPONSE');
  return parsed.data;
}
