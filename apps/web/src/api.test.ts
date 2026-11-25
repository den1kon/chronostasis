import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  ApiClientError,
  getCurrentUser,
  initializeUser,
  getSyncSnapshot,
  postSyncOperations,
} from './api';
const user = {
  id: '5e15220e-96eb-4123-8cd1-3fc37b06446a',
  clerkUserId: 'user_fixture',
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('browser API client', () => {
  it.each([
    ['POST', initializeUser],
    ['GET', getCurrentUser],
  ] as const)(
    'sends a bearer token on %s and parses the public user',
    async (method, call) => {
      const fetcher = vi.fn().mockResolvedValue(Response.json({user}));
      vi.stubGlobal('fetch', fetcher);
      expect(await call('fresh-token')).toEqual(user);
      expect(fetcher).toHaveBeenCalledWith(
        '/api/me',
        expect.objectContaining({
          method,
          headers: {
            Accept: 'application/json',
            Authorization: 'Bearer fresh-token',
          },
        }),
      );
    },
  );
  it.each([
    {user: {id: 'invalid', clerkUserId: 'user_fixture'}},
    {user: null},
    {},
  ])('rejects invalid response contracts', async payload => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload)));
    await expect(getCurrentUser('token')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'The server returned an unexpected response.',
    });
  });
  it('rejects malformed JSON safely', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('private internal response')),
    );
    await expect(getCurrentUser('token')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('converts network errors into a safe retryable failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('secret internals')),
    );
    await expect(initializeUser('token')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      retryable: true,
      message: 'Could not reach the server. Please try again.',
    });
  });
  it('handles an expired session without trusting its response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('private', {status: 401})),
    );
    await expect(getCurrentUser('token')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      retryable: false,
      message: 'Your session needs to be refreshed. Please sign in again.',
    });
  });
  it('rejects an absent token before sending a request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(getCurrentUser('')).rejects.toBeInstanceOf(ApiClientError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('aborts a pending fetch when the caller cancels', async () => {
    const fetcher = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            reject(new Error('Fetch aborted'));
          });
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const request = getCurrentUser('token', controller.signal);
    const failure = expect(request).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    await Promise.resolve();
    controller.abort();
    await failure;
    expect(fetcher.mock.calls[0]?.[1].signal?.aborted).toBe(true);
  });
  it('returns a safe retryable server failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('SQL private', {status: 503})),
    );
    await expect(getCurrentUser('token')).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      retryable: true,
      message: 'Could not sync your account. Please try again.',
    });
  });
});

describe('sync API', () => {
  it('checks both opaque versions and validates the unchanged response', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        Response.json({unchanged: true, revision: 2, catalogueVersion: 'x+y'}),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    const versions = {revision: 2, catalogueVersion: 'x+y'};
    expect(await getSyncSnapshot('secret', undefined, versions)).toEqual({
      unchanged: true,
      ...versions,
    });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/sync?revision=2&catalogueVersion=x%2By',
      expect.objectContaining({
        method: 'GET',
        headers: {Accept: 'application/json', Authorization: 'Bearer secret'},
      }),
    );
    await expect(getSyncSnapshot('secret')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(
      getSyncSnapshot('secret', undefined, {...versions, revision: 1}),
    ).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
  });
  it('posts exactly the ordered JSON and rejects uncorrelated acknowledgements', async () => {
    const snapshot = {
      revision: 0,
      catalogueVersion: 'x',
      user: {id: user.id, coins: 0},
      catalogue: {chests: [], items: [], chestItems: []},
      sessions: [],
      items: [],
      userChests: [],
    };
    const operation = {
      type: 'buy_chest' as const,
      operationId: crypto.randomUUID(),
      chestId: 'basic',
    };
    const outcome = {
      type: operation.type,
      operationId: operation.operationId,
      status: 'accepted',
      retryable: false,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({snapshot, outcomes: [outcome]}))
      .mockResolvedValueOnce(Response.json({snapshot, outcomes: []}));
    vi.stubGlobal('fetch', fetcher);
    expect(await postSyncOperations('token', [operation])).toEqual({
      snapshot,
      outcomes: [outcome],
    });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/sync',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({operations: [operation]}),
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        },
      }),
    );
    await expect(
      postSyncOperations('token', [operation]),
    ).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
  });
});

it('treats an interrupted response body as a retryable transport failure', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.error(new TypeError('connection reset'));
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
  await expect(getSyncSnapshot('token')).rejects.toMatchObject({
    code: 'NETWORK_ERROR',
    retryable: true,
  });
});

it.each(['headers', 'body'] as const)(
  'times out a stalled response while reading %s',
  async phase => {
    vi.useFakeTimers();
    const fetcher = vi.fn<
      (url: string, options: RequestInit) => Promise<Response>
    >(() =>
      phase === 'headers'
        ? new Promise<Response>(() => {})
        : Promise.resolve(new Response(new ReadableStream())),
    );
    vi.stubGlobal('fetch', fetcher);
    let error: unknown;
    void getSyncSnapshot('token').catch((failure: unknown) => {
      error = failure;
    });

    await vi.advanceTimersByTimeAsync(14_999);
    expect(error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(error).toMatchObject({code: 'NETWORK_ERROR', retryable: true});
    expect(fetcher.mock.calls[0]?.[1].signal?.aborted).toBe(true);
  },
);
