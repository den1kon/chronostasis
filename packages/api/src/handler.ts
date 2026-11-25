import {
  OperationOutcomeSchema,
  SyncOperationSchema,
  SyncRequestEnvelopeSchema,
  UserResponseSchema,
  UserSnapshotSchema,
  type OperationOutcome,
  type PublicUser,
  type SnapshotResponse,
  type SyncOperation,
  type SyncResponse,
  type UserSnapshot,
} from '../../contracts/src/index.js';
import {AuthenticationUnavailableError} from './auth-error.js';

export interface ApiDependencies {
  authenticate(request: Request): Promise<{clerkUserId: string} | null>;
  ensureUser(clerkUserId: string): Promise<PublicUser>;
  findUser(clerkUserId: string): Promise<PublicUser | null>;
  probe(): Promise<void>;
  getSnapshot(clerkUserId: string): Promise<UserSnapshot>;
  processOperation(
    clerkUserId: string,
    operation: SyncOperation,
  ): Promise<OperationOutcome>;
}

const noStoreHeaders = {'Cache-Control': 'no-store'};
const operationCorrelation = OperationOutcomeSchema.pick({
  operationId: true,
  type: true,
}).strip();

export function apiError(
  status: number,
  code: string,
  message: string,
  headers?: Readonly<Record<string, string>>,
): Response {
  return Response.json(
    {error: {code, message}},
    {status, headers: {...noStoreHeaders, ...headers}},
  );
}

// A freshness check needs one value for each version. An empty result requests a full snapshot.
function readSyncVersions(search: URLSearchParams) {
  const revisions = search.getAll('revision');
  const catalogueVersions = search.getAll('catalogueVersion');
  if (revisions.length === 0 && catalogueVersions.length === 0) return {};
  const [revisionText] = revisions;
  const [catalogueVersion] = catalogueVersions;
  const revision = Number(revisionText);
  if (
    revisions.length !== 1 ||
    catalogueVersions.length !== 1 ||
    revisionText === undefined ||
    !/^\d+$/.test(revisionText) ||
    !Number.isSafeInteger(revision) ||
    !catalogueVersion
  ) {
    return null;
  }
  return {revision, catalogueVersion};
}

// Validate all correlation fields before processing any operations. Invalid payloads with
// usable correlation fields can be acknowledged individually in batch order.
async function readSyncBatch(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  const envelope = SyncRequestEnvelopeSchema.safeParse(body);
  if (!envelope.success) return null;

  const batch: Array<SyncOperation | OperationOutcome> = [];
  for (const entry of envelope.data.operations) {
    const operation = SyncOperationSchema.safeParse(entry);
    if (operation.success) {
      batch.push(operation.data);
    } else {
      const correlation = operationCorrelation.safeParse(entry);
      if (!correlation.success) return null;
      batch.push(
        OperationOutcomeSchema.parse({
          ...correlation.data,
          status: 'rejected',
          code: 'INVALID_OPERATION',
          message: 'Invalid sync operation',
        }),
      );
    }
  }
  return batch;
}

async function getSyncSnapshot(
  deps: ApiDependencies,
  clerkUserId: string,
  search: URLSearchParams,
) {
  const versions = readSyncVersions(search);
  if (!versions) return apiError(400, 'BAD_REQUEST', 'Invalid sync versions');

  await deps.ensureUser(clerkUserId);
  const snapshot = UserSnapshotSchema.parse(
    await deps.getSnapshot(clerkUserId),
  );
  const {revision, catalogueVersion} = snapshot;
  const unchanged =
    versions.revision === revision &&
    versions.catalogueVersion === catalogueVersion;
  const result: SnapshotResponse = unchanged
    ? {unchanged, revision, catalogueVersion}
    : {unchanged, snapshot};
  return Response.json(result, {headers: noStoreHeaders});
}

async function postSyncOperations(
  deps: ApiDependencies,
  clerkUserId: string,
  request: Request,
) {
  const batch = await readSyncBatch(request);
  if (!batch) return apiError(400, 'BAD_REQUEST', 'Invalid sync request');

  await deps.ensureUser(clerkUserId);
  const outcomes: OperationOutcome[] = [];
  // Each repository call commits independently before the next operation starts.
  for (const entry of batch) {
    if ('status' in entry) {
      outcomes.push(entry);
    } else {
      const outcome = OperationOutcomeSchema.parse(
        await deps.processOperation(clerkUserId, entry),
      );
      if (
        outcome.operationId !== entry.operationId ||
        outcome.type !== entry.type
      )
        throw new Error('Repository returned an unmatched sync outcome');
      outcomes.push(outcome);
    }
  }
  const snapshot = UserSnapshotSchema.parse(
    await deps.getSnapshot(clerkUserId),
  );
  return Response.json({outcomes, snapshot} satisfies SyncResponse, {
    headers: noStoreHeaders,
  });
}

export function createApiHandler(deps: ApiDependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path !== '/api/health' && path !== '/api/me' && path !== '/api/sync')
        return apiError(404, 'NOT_FOUND', 'Not found');
      const allowed = path === '/api/health' ? ['GET'] : ['GET', 'POST'];
      if (!allowed.includes(request.method))
        return apiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed', {
          Allow: allowed.join(', '),
        });
      if (path === '/api/health') {
        try {
          await deps.probe();
        } catch {
          return apiError(503, 'UNAVAILABLE', 'Service unavailable');
        }
        return Response.json({status: 'ok'}, {headers: noStoreHeaders});
      }
      const identity = await deps.authenticate(request);
      if (!identity)
        return apiError(401, 'UNAUTHORIZED', 'Authentication required');
      if (path === '/api/sync') {
        return request.method === 'GET'
          ? await getSyncSnapshot(deps, identity.clerkUserId, url.searchParams)
          : await postSyncOperations(deps, identity.clerkUserId, request);
      }
      const user =
        request.method === 'POST'
          ? await deps.ensureUser(identity.clerkUserId)
          : await deps.findUser(identity.clerkUserId);
      if (!user) return apiError(404, 'NOT_FOUND', 'Not found');
      return Response.json(UserResponseSchema.parse({user}), {
        headers: noStoreHeaders,
      });
    } catch (error) {
      if (error instanceof AuthenticationUnavailableError)
        return apiError(503, 'UNAVAILABLE', 'Service unavailable');
      return apiError(500, 'INTERNAL_ERROR', 'Internal server error');
    }
  };
}
