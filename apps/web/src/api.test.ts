import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, getCurrentUser, initializeUser } from './api';
const user = { id: '5e15220e-96eb-4123-8cd1-3fc37b06446a', clerkUserId: 'user_fixture' };
afterEach(() => { vi.unstubAllGlobals(); });

describe('browser API client', () => {
  it.each([['POST', initializeUser], ['GET', getCurrentUser]] as const)('sends a bearer token on %s and parses the public user', async (method, call) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ user }));
    vi.stubGlobal('fetch', fetcher);
    expect(await call('fresh-token')).toEqual(user);
    expect(fetcher).toHaveBeenCalledWith('/api/me', expect.objectContaining({ method, headers: { Accept: 'application/json', Authorization: 'Bearer fresh-token' } }));
  });
  it.each([{ user: { id: 'invalid', clerkUserId: 'user_fixture' } }, { user: null }, {}])('rejects invalid response contracts', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload)));
    await expect(getCurrentUser('token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', message: 'The server returned an unexpected response.' });
  });
  it('rejects malformed JSON safely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private internal response')));
    await expect(getCurrentUser('token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('converts network errors into a safe retryable failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret internals')));
    await expect(initializeUser('token')).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true, message: 'Could not reach the server. Please try again.' });
  });
  it('handles an expired session without trusting its response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private', { status: 401 })));
    await expect(getCurrentUser('token')).rejects.toMatchObject({ code: 'UNAUTHORIZED', retryable: false, message: 'Your session needs to be refreshed. Please sign in again.' });
  });
  it('rejects an absent token before sending a request', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(getCurrentUser('')).rejects.toBeInstanceOf(ApiClientError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('passes cancellation to fetch', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ user })); vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    await getCurrentUser('token', controller.signal);
    expect(fetcher).toHaveBeenCalledWith('/api/me', expect.objectContaining({ signal: controller.signal }));
  });
  it('returns a safe retryable server failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('SQL private', { status: 503 })));
    await expect(getCurrentUser('token')).rejects.toMatchObject({ code: 'REQUEST_FAILED', retryable: true, message: 'Could not sync your account. Please try again.' });
  });
});
