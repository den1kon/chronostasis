import {createServer, type Server} from 'node:http';
import {once} from 'node:events';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import type {VercelRequest, VercelResponse} from '@vercel/node';
import {toNodeHandler, toVercelHandler} from './adapters';
import {createApiHandler} from './handler';

const user = {
  id: '5e15220e-96eb-4123-8cd1-3fc37b06446a',
  clerkUserId: 'user_verified',
};
const realHandler = createApiHandler({
  authenticate: request =>
    Promise.resolve(
      request.headers.get('authorization') === 'Bearer fixture'
        ? {clerkUserId: user.clerkUserId}
        : null,
    ),
  ensureUser: () => Promise.resolve(user),
  findUser: () => Promise.resolve(user),
  probe: () => Promise.resolve(),
});
const observed = vi.fn(async (request: Request) => {
  if (new URL(request.url).pathname === '/api/echo')
    return Response.json(
      {
        method: request.method,
        body: await request.text(),
        authorization: request.headers.get('authorization'),
        url: request.url,
      },
      {status: 201, headers: {'Cache-Control': 'no-store', Allow: 'GET, POST'}},
    );
  return realHandler(request);
});
const servers: Server[] = [];
const origins: string[] = [];
beforeAll(async () => {
  const local = toNodeHandler(observed, 'https://api.example');
  const vercel = toVercelHandler(observed);
  for (const kind of ['local', 'vercel']) {
    const server = createServer((request, response) => {
      if (kind === 'local') void local(request, response);
      else {
        // A standalone Vercel invocation decorates the same Node HTTP objects.
        // This getter guards against accidental parsed-body access.
        Object.defineProperty(request, 'body', {
          get() {
            throw new Error('Do not reserialize the parsed Vercel body');
          },
        });
        request.headers.host = 'api.example';
        request.headers['x-forwarded-proto'] = 'https';
        void vercel(request as VercelRequest, response as VercelResponse);
      }
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No test listener');
    origins.push(`http://127.0.0.1:${String(address.port)}`);
  }
});
afterAll(async () => {
  await Promise.all(
    servers.map(
      server =>
        new Promise<void>((resolve, reject) => {
          server.close(error => {
            if (error) reject(error);
            else resolve();
          });
          server.closeAllConnections();
        }),
    ),
  );
});
async function both(path: string, init?: RequestInit) {
  const results = await Promise.all(
    origins.map(async origin => {
      const response = await fetch(origin + path, init);
      return {
        status: response.status,
        body: (await response.json()) as unknown,
        cache: response.headers.get('cache-control'),
        allow: response.headers.get('allow'),
      };
    }),
  );
  expect(results[0]).toEqual(results[1]);
  const result = results[0];
  if (!result) throw new Error('Missing adapter result');
  return result;
}

describe('local and Vercel adapter parity', () => {
  it('probes health and forwards bearer credentials to shared handlers', async () => {
    expect((await both('/api/health')).status).toBe(200);
    expect((await both('/api/me')).status).toBe(401);
    expect(
      (await both('/api/me', {headers: {authorization: 'Bearer fixture'}}))
        .body,
    ).toEqual({user});
  });
  it('preserves raw POST bytes, method, headers, URL and response headers', async () => {
    const body = ' {"forged": "é"}\n';
    expect(
      await both('/api/echo?mode=raw', {
        method: 'POST',
        body,
        headers: {authorization: 'Bearer fixture'},
      }),
    ).toEqual({
      status: 201,
      body: {
        method: 'POST',
        body,
        authorization: 'Bearer fixture',
        url: 'https://api.example/api/echo?mode=raw',
      },
      cache: 'no-store',
      allow: 'GET, POST',
    });
  });
  it('forwards an empty POST', async () => {
    const result = await both('/api/echo', {method: 'POST'});
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({body: '', method: 'POST'});
  });
  it('preserves method errors and unknown routes', async () => {
    const method = await both('/api/me', {method: 'PUT'});
    expect(method.status).toBe(405);
    expect(method.allow).toBe('GET, POST');
    expect((await both('/api/missing')).status).toBe(404);
  });
  it('accepts exactly 64 KiB measured in bytes', async () => {
    const body = 'é'.repeat(32768);
    expect(
      (await both('/api/echo', {method: 'POST', body})).body,
    ).toMatchObject({body});
  });
  it('rejects limit + 1 without dispatching either handler', async () => {
    observed.mockClear();
    const result = await both('/api/echo', {
      method: 'POST',
      body: 'a'.repeat(65537),
    });
    expect(result.status).toBe(413);
    expect(result.body).toEqual({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body exceeds 64 KiB',
      },
    });
    expect(observed).not.toHaveBeenCalled();
  });
  it('bounds chunked requests without relying on Content-Length', async () => {
    observed.mockClear();
    for (const origin of origins) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(65536));
          controller.enqueue(new Uint8Array(1));
          controller.close();
        },
      });
      const response = await fetch(`${origin}/api/echo`, {
        method: 'POST',
        body,
        duplex: 'half',
      } as RequestInit);
      expect(response.status).toBe(413);
      await response.arrayBuffer();
    }
    expect(observed).not.toHaveBeenCalled();
  });
});
