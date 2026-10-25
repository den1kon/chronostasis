// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountGate } from './account-gate';
const signInAgain = vi.fn(() => Promise.resolve());
const user = { id: '5e15220e-96eb-4123-8cd1-3fc37b06446a', clerkUserId: 'user_fixture' };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Not initialized'); };
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
describe('account synchronization gate', () => {
  it('waits for POST then GET and obtains a token for each request', async () => {
    const read = deferred<Response>();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ user })).mockReturnValueOnce(read.promise);
    vi.stubGlobal('fetch', fetcher);
    const getToken = vi.fn().mockResolvedValueOnce('post-token').mockResolvedValueOnce('read-token');
    render(<AccountGate signInAgain={signInAgain} getToken={getToken}><p>Focus placeholder</p></AccountGate>);
    await waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(2); });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/me');
    const writeOptions: unknown = fetcher.mock.calls[0]?.[1];
    expect(writeOptions).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer post-token' } });
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/me');
    const readOptions: unknown = fetcher.mock.calls[1]?.[1];
    expect(readOptions).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer read-token' } });
    expect(screen.queryByText('Account ready')).toBeNull();
    expect(screen.queryByText('Focus placeholder')).toBeNull();
    await act(async () => { read.resolve(Response.json({ user })); await read.promise; });
    expect(await screen.findByText('Account ready')).toBeTruthy();
    expect(screen.getByText('Focus placeholder')).toBeTruthy();
  });
  it('does not show ready on 401 and lets the user refresh the session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    render(<AccountGate signInAgain={signInAgain} getToken={() => Promise.resolve('expired')}><p>Focus placeholder</p></AccountGate>);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Your session needs to be refreshed. Please sign in again.');
    expect(screen.queryByText('Account ready')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(signInAgain).toHaveBeenCalledOnce();
  });
  it('retries a transient failure and only unlocks after the read succeeds', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('private')).mockImplementation(() => Promise.resolve(Response.json({ user })));
    vi.stubGlobal('fetch', fetcher);
    render(<AccountGate signInAgain={signInAgain} getToken={() => Promise.resolve('token')}><p>Inventory placeholder</p></AccountGate>);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Account ready')).toBeTruthy();
    expect(screen.getByText('Inventory placeholder')).toBeTruthy();
  });
  it('does not initialize without a session token', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    render(<AccountGate signInAgain={signInAgain} getToken={() => Promise.resolve(null)}><p>Focus</p></AccountGate>);
    await screen.findByRole('alert');
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.queryByText('Account ready')).toBeNull();
  });
  it('cancels old identity work on unmount and never unlocks the next account with its response', async () => {
    const oldRequest = deferred<Response>();
    const newRequest = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    vi.stubGlobal('fetch', fetcher);
    const view = render(<AccountGate signInAgain={signInAgain} getToken={() => Promise.resolve('old')}><p>Old account</p></AccountGate>);
    await waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(1); });
    const options: unknown = fetcher.mock.calls[0]?.[1];
    view.unmount();
    expect(options).toHaveProperty('signal.aborted', true);
    render(<AccountGate signInAgain={signInAgain} getToken={() => Promise.resolve('new')}><p>New account</p></AccountGate>);
    await waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(2); });
    await act(async () => { oldRequest.resolve(Response.json({ user })); await oldRequest.promise; });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Account ready')).toBeNull();
    expect(screen.queryByText('Old account')).toBeNull();
  });
  it('rejects inconsistent initialization and read identities', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ user })).mockResolvedValueOnce(Response.json({ user: { ...user, id: '84c2156b-7c86-409c-bec1-ee5f4e875613' } })));
    render(<AccountGate signInAgain={signInAgain} getToken={() => Promise.resolve('token')}><p>Focus</p></AccountGate>);
    await screen.findByRole('alert');
    expect(screen.queryByText('Account ready')).toBeNull();
  });
});
