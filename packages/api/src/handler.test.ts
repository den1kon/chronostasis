import {describe, expect, it, vi} from 'vitest';
import type {UserSnapshot} from '../../contracts/src/index.js';
import {createApiHandler, type ApiDependencies} from './handler';

const user = {
  id: '5e15220e-96eb-4123-8cd1-3fc37b06446a',
  clerkUserId: 'user_verified',
};
const snapshot: UserSnapshot = {
  revision: 7,
  catalogueVersion: 'catalogue-7',
  user: {id: user.id, coins: 0},
  catalogue: {items: [], chests: [], chestItems: []},
  userChests: [],
  items: [],
  sessions: [],
};
const buyChest = {
  operationId: '8d911870-547e-4edf-ae20-a78e78d8b14c',
  type: 'buy_chest',
  chestId: 'basic-chest',
} as const;
const startSession = {
  operationId: '39313129-efc7-441b-b13c-7073fb37f859',
  type: 'start_session',
  sessionId: '24008e68-5c87-49f6-82ed-f109cfed963f',
  chestId: 'basic-chest',
  plannedDurationSeconds: 900,
} as const;
const claimReward = {
  operationId: '5803a6d5-fd9b-4d9d-8ecb-66a3ecce0ca0',
  type: 'claim_reward',
  sessionId: startSession.sessionId,
} as const;
function setup() {
  const deps = {
    authenticate: vi
      .fn<ApiDependencies['authenticate']>()
      .mockResolvedValue({clerkUserId: user.clerkUserId}),
    ensureUser: vi.fn<ApiDependencies['ensureUser']>().mockResolvedValue(user),
    findUser: vi.fn<ApiDependencies['findUser']>().mockResolvedValue(user),
    probe: vi.fn<ApiDependencies['probe']>().mockResolvedValue(undefined),
    getSnapshot: vi
      .fn<ApiDependencies['getSnapshot']>()
      .mockResolvedValue(snapshot),
    processOperation: vi.fn<ApiDependencies['processOperation']>(),
  };
  return {deps, handler: createApiHandler(deps)};
}
const request = (path: string, method = 'GET', body?: string) =>
  new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : {body}),
  });

describe('shared API contracts', () => {
  it('probes the database for health without authentication', async () => {
    const {handler, deps} = setup();
    const response = await handler(request('/api/health'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({status: 'ok'});
    expect(deps.probe).toHaveBeenCalledOnce();
    expect(deps.authenticate).not.toHaveBeenCalled();
  });
  it('returns a safe unavailable health response', async () => {
    const {handler, deps} = setup();
    deps.probe.mockRejectedValue(new Error('SQL password=private'));
    const response = await handler(request('/api/health'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {code: 'UNAVAILABLE', message: 'Service unavailable'},
    });
  });
  it.each(['GET', 'POST'])(
    'rejects unauthenticated %s before database access',
    async method => {
      const {handler, deps} = setup();
      deps.authenticate.mockResolvedValue(null);
      const response = await handler(request('/api/me', method));
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({
        error: {code: 'UNAUTHORIZED', message: 'Authentication required'},
      });
      expect(deps.ensureUser).not.toHaveBeenCalled();
      expect(deps.findUser).not.toHaveBeenCalled();
    },
  );
  it('initializes only the verified subject, ignoring forged or malformed bodies', async () => {
    const {handler, deps} = setup();
    for (const body of ['{"clerkUserId":"attacker"}', 'malformed json', '']) {
      const response = await handler(request('/api/me', 'POST', body));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({user});
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(deps.ensureUser.mock.calls).toEqual([
      [user.clerkUserId],
      [user.clerkUserId],
      [user.clerkUserId],
    ]);
    expect(deps.findUser).not.toHaveBeenCalled();
  });
  it('reads only the current subject', async () => {
    const {handler, deps} = setup();
    const response = await handler(request('/api/me?clerkUserId=attacker'));
    expect(await response.json()).toEqual({user});
    expect(deps.findUser).toHaveBeenCalledWith(user.clerkUserId);
    expect(deps.ensureUser).not.toHaveBeenCalled();
  });
  it('returns 404 for an uninitialized user', async () => {
    const {handler, deps} = setup();
    deps.findUser.mockResolvedValue(null);
    expect((await handler(request('/api/me'))).status).toBe(404);
  });
  it.each([
    ['/api/me', 'GET, POST'],
    ['/api/health', 'GET'],
    ['/api/sync', 'GET, POST'],
  ])('restricts methods on %s', async (path, allow) => {
    const {handler, deps} = setup();
    const response = await handler(request(path, 'PUT'));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe(allow);
    expect(deps.ensureUser).not.toHaveBeenCalled();
    expect(deps.probe).not.toHaveBeenCalled();
  });
  it('returns JSON 404 for unknown routes', async () => {
    const {handler} = setup();
    const response = await handler(request('/api/missing'));
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
  });
  it('does not expose unexpected exceptions', async () => {
    const {handler, deps} = setup();
    deps.ensureUser.mockRejectedValue(new Error('SQL stack password=private'));
    const response = await handler(request('/api/me', 'POST'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {code: 'INTERNAL_ERROR', message: 'Internal server error'},
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('authenticated sync API', () => {
  it.each(['GET', 'POST'])(
    'authenticates sync %s before database access',
    async method => {
      const {handler, deps} = setup();
      deps.authenticate.mockResolvedValue(null);
      const response = await handler(request('/api/sync', method));
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(deps.ensureUser).not.toHaveBeenCalled();
      expect(deps.getSnapshot).not.toHaveBeenCalled();
      expect(deps.processOperation).not.toHaveBeenCalled();
    },
  );

  it('initializes the authenticated account before serving a full snapshot', async () => {
    const {handler, deps} = setup();
    const initial = {...snapshot, revision: 0};
    deps.ensureUser.mockImplementation(async subject => {
      expect(subject).toBe('user_verified');
      await Promise.resolve();
      deps.getSnapshot.mockResolvedValueOnce(initial);
      return user;
    });
    const response = await handler(
      request('/api/sync?clerkUserId=user_forged'),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      unchanged: false,
      snapshot: initial,
    });
    expect(deps.getSnapshot).toHaveBeenCalledExactlyOnceWith('user_verified');
    expect(deps.findUser).not.toHaveBeenCalled();
  });

  it.each([
    ['revision=7&catalogueVersion=catalogue-7', true],
    ['revision=6&catalogueVersion=catalogue-7', false],
    ['revision=7&catalogueVersion=previous-catalogue', false],
  ])('checks both versions for %s', async (query, unchanged) => {
    const {handler} = setup();
    const response = await handler(request(`/api/sync?${query}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(
      unchanged
        ? {unchanged: true, revision: 7, catalogueVersion: 'catalogue-7'}
        : {unchanged: false, snapshot},
    );
  });

  it.each([
    'revision=7',
    'catalogueVersion=catalogue-7',
    'revision=&catalogueVersion=catalogue-7',
    'revision=-1&catalogueVersion=catalogue-7',
    'revision=7.5&catalogueVersion=catalogue-7',
    'revision=7e0&catalogueVersion=catalogue-7',
    'revision=9007199254740992&catalogueVersion=catalogue-7',
    'revision=7&catalogueVersion=',
    'revision=7&revision=8&catalogueVersion=catalogue-7',
    'revision=7&catalogueVersion=catalogue-7&catalogueVersion=catalogue-8',
  ])(
    'rejects invalid freshness query %s before initialization',
    async query => {
      const {handler, deps} = setup();
      const response = await handler(request(`/api/sync?${query}`));
      expect(response.status).toBe(400);
      expect(deps.ensureUser).not.toHaveBeenCalled();
      expect(deps.getSnapshot).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['malformed JSON', '{broken'],
    ['empty body', ''],
    ['empty batch', '{"operations":[]}'],
    ['missing operations', '{}'],
    [
      'oversize batch',
      JSON.stringify({operations: Array.from({length: 101}, () => buyChest)}),
    ],
    [
      'invalid revision',
      JSON.stringify({operations: [buyChest], knownRevision: -1}),
    ],
    [
      'attempted identity override',
      JSON.stringify({operations: [buyChest], clerkUserId: 'user_forged'}),
    ],
    [
      'unknown operation type',
      JSON.stringify({
        operations: [buyChest, {...startSession, type: 'unknown'}],
      }),
    ],
    [
      'invalid correlation ID',
      JSON.stringify({
        operations: [buyChest, {...startSession, operationId: 'invalid'}],
      }),
    ],
    ['missing correlation', JSON.stringify({operations: [buyChest, null]})],
  ])(
    'rejects %s before initializing or processing any entries',
    async (_label, body) => {
      const {handler, deps} = setup();
      const response = await handler(request('/api/sync', 'POST', body));
      expect(response.status).toBe(400);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toMatchObject({
        error: {code: 'BAD_REQUEST'},
      });
      expect(deps.ensureUser).not.toHaveBeenCalled();
      expect(deps.processOperation).not.toHaveBeenCalled();
      expect(deps.getSnapshot).not.toHaveBeenCalled();
    },
  );

  it('processes stale batches in order and returns a snapshot with accepted and rejected outcomes', async () => {
    const {handler, deps} = setup();
    const processed: string[] = [];
    let initialized = false;
    deps.ensureUser.mockImplementation(async subject => {
      expect(subject).toBe('user_verified');
      await Promise.resolve();
      initialized = true;
      return user;
    });
    deps.processOperation.mockImplementation(async (subject, operation) => {
      expect(initialized).toBe(true);
      expect(subject).toBe('user_verified');
      if (operation.type === 'claim_reward')
        expect(processed).toEqual(['buy_chest']);
      await Promise.resolve();
      processed.push(operation.type);
      const {operationId, type} = operation;
      return type === 'buy_chest'
        ? {operationId, type, status: 'accepted', retryable: false}
        : {
            operationId,
            type,
            status: 'rejected',
            code: 'TOO_EARLY',
            retryable: true,
          };
    });
    deps.getSnapshot.mockImplementation(subject => {
      expect(subject).toBe('user_verified');
      expect(processed).toEqual(['buy_chest', 'claim_reward']);
      return Promise.resolve(snapshot);
    });
    const response = await handler(
      request(
        '/api/sync',
        'POST',
        JSON.stringify({
          knownRevision: 1,
          operations: [
            buyChest,
            {...startSession, plannedDurationSeconds: 'private input'},
            claimReward,
          ],
        }),
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const result: unknown = await response.json();
    expect(result).toEqual({
      outcomes: [
        {
          operationId: buyChest.operationId,
          type: 'buy_chest',
          status: 'accepted',
          retryable: false,
        },
        {
          operationId: startSession.operationId,
          type: 'start_session',
          status: 'rejected',
          code: 'INVALID_OPERATION',
          message: 'Invalid sync operation',
          retryable: false,
        },
        {
          operationId: claimReward.operationId,
          type: 'claim_reward',
          status: 'rejected',
          code: 'TOO_EARLY',
          retryable: true,
        },
      ],
      snapshot,
    });
    expect(JSON.stringify(result)).not.toContain('private input');
    expect(deps.processOperation.mock.calls).toEqual([
      ['user_verified', buyChest],
      ['user_verified', claimReward],
    ]);
  });

  it('returns a full snapshot even if every operation is rejected', async () => {
    const {handler, deps} = setup();
    const response = await handler(
      request(
        '/api/sync',
        'POST',
        JSON.stringify({
          knownRevision: 7,
          operations: [{...buyChest, clerkUserId: 'user_forged'}],
        }),
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      outcomes: [
        {
          operationId: buyChest.operationId,
          status: 'rejected',
          retryable: false,
        },
      ],
      snapshot,
    });
    expect(deps.processOperation).not.toHaveBeenCalled();
  });

  it('halts the batch on infrastructure failure and safely reports 500', async () => {
    const {handler, deps} = setup();
    const processed: string[] = [];
    deps.processOperation.mockImplementation(async (_subject, op) => {
      await Promise.resolve();
      if (op.type === 'start_session')
        throw new Error('SELECT private details');
      processed.push(op.type);
      return {
        operationId: op.operationId,
        type: op.type,
        status: 'accepted',
        retryable: false,
      };
    });
    const response = await handler(
      request(
        '/api/sync',
        'POST',
        JSON.stringify({
          operations: [buyChest, startSession, claimReward],
        }),
      ),
    );
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: {code: 'INTERNAL_ERROR', message: 'Internal server error'},
    });
    expect(processed).toEqual(['buy_chest']);
    expect(deps.getSnapshot).not.toHaveBeenCalled();
  });

  it('fails safely when snapshot retrieval fails', async () => {
    const {handler, deps} = setup();
    deps.getSnapshot.mockRejectedValue(new Error('SELECT private details'));
    const response = await handler(request('/api/sync'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {code: 'INTERNAL_ERROR', message: 'Internal server error'},
    });
  });

  it('does not return a sync snapshot containing a private subject', async () => {
    const {handler, deps} = setup();
    deps.getSnapshot.mockResolvedValue({
      ...snapshot,
      user: {...user, coins: 0},
    });
    const response = await handler(request('/api/sync'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {code: 'INTERNAL_ERROR', message: 'Internal server error'},
    });
  });

  it('halts when a repository outcome cannot be correlated to the submitted operation', async () => {
    const {handler, deps} = setup();
    deps.processOperation.mockResolvedValueOnce({
      operationId: startSession.operationId,
      type: buyChest.type,
      status: 'accepted',
      retryable: false,
    });
    const response = await handler(
      request(
        '/api/sync',
        'POST',
        JSON.stringify({
          operations: [buyChest, startSession],
        }),
      ),
    );
    expect(response.status).toBe(500);
    expect(deps.processOperation).toHaveBeenCalledExactlyOnceWith(
      'user_verified',
      buyChest,
    );
    expect(deps.getSnapshot).not.toHaveBeenCalled();
  });
});
