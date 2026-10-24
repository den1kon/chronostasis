import { describe, expect, it, vi } from 'vitest';
import { createApiHandler, type ApiDependencies } from './handler';

const user = { id: '5e15220e-96eb-4123-8cd1-3fc37b06446a', clerkUserId: 'user_verified' };
function setup() {
  const deps = {
    authenticate: vi.fn<ApiDependencies['authenticate']>().mockResolvedValue({ clerkUserId: user.clerkUserId }),
    ensureUser: vi.fn<ApiDependencies['ensureUser']>().mockResolvedValue(user),
    findUser: vi.fn<ApiDependencies['findUser']>().mockResolvedValue(user),
    probe: vi.fn<ApiDependencies['probe']>().mockResolvedValue(undefined),
  };
  return { deps, handler: createApiHandler(deps) };
}
const request = (path: string, method = 'GET', body?: string) => new Request(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body }) });

describe('shared API contracts', () => {
  it('probes the database for health without authentication', async () => {
    const { handler, deps } = setup();
    const response = await handler(request('/api/health'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(deps.probe).toHaveBeenCalledOnce();
    expect(deps.authenticate).not.toHaveBeenCalled();
  });
  it('returns a safe unavailable health response', async () => {
    const { handler, deps } = setup();
    deps.probe.mockRejectedValue(new Error('SQL password=private'));
    const response = await handler(request('/api/health'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'UNAVAILABLE', message: 'Service unavailable' } });
  });
  it.each(['GET', 'POST'])('rejects unauthenticated %s before database access', async (method) => {
    const { handler, deps } = setup();
    deps.authenticate.mockResolvedValue(null);
    const response = await handler(request('/api/me', method));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    expect(deps.ensureUser).not.toHaveBeenCalled();
    expect(deps.findUser).not.toHaveBeenCalled();
  });
  it('initializes only the verified subject, ignoring forged or malformed bodies', async () => {
    const { handler, deps } = setup();
    for (const body of ['{"clerkUserId":"attacker"}', 'malformed json', '']) {
      const response = await handler(request('/api/me', 'POST', body));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ user });
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(deps.ensureUser.mock.calls).toEqual([[user.clerkUserId], [user.clerkUserId], [user.clerkUserId]]);
    expect(deps.findUser).not.toHaveBeenCalled();
  });
  it('reads only the current subject', async () => {
    const { handler, deps } = setup();
    const response = await handler(request('/api/me?clerkUserId=attacker'));
    expect(await response.json()).toEqual({ user });
    expect(deps.findUser).toHaveBeenCalledWith(user.clerkUserId);
    expect(deps.ensureUser).not.toHaveBeenCalled();
  });
  it('returns 404 for an uninitialized user', async () => {
    const { handler, deps } = setup();
    deps.findUser.mockResolvedValue(null);
    expect((await handler(request('/api/me'))).status).toBe(404);
  });
  it.each([['/api/me', 'GET, POST'], ['/api/health', 'GET']])('restricts methods on %s', async (path, allow) => {
    const { handler, deps } = setup();
    const response = await handler(request(path, 'PUT'));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe(allow);
    expect(deps.ensureUser).not.toHaveBeenCalled();
    expect(deps.probe).not.toHaveBeenCalled();
  });
  it('returns JSON 404 for unknown routes', async () => {
    const { handler } = setup();
    const response = await handler(request('/api/missing'));
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
  });
  it('does not expose unexpected exceptions', async () => {
    const { handler, deps } = setup();
    deps.ensureUser.mockRejectedValue(new Error('SQL stack password=private'));
    const response = await handler(request('/api/me', 'POST'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
