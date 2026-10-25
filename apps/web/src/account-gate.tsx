import {useEffect, useState, type ReactNode} from 'react';
import {ApiClientError, getCurrentUser, initializeUser} from './api';

type State =
  | {status: 'loading'}
  | {status: 'ready'}
  | {status: 'error'; error: ApiClientError};
interface Props {
  getToken: () => Promise<string | null>;
  signInAgain: () => Promise<void>;
  children: ReactNode;
}
export function AccountGate({getToken, signInAgain, children}: Props) {
  const [state, setState] = useState<State>({status: 'loading'});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const cancelled = () => controller.signal.aborted;
    const sync = async () => {
      try {
        const writeToken = await getToken();
        if (cancelled()) return;
        if (!writeToken) throw new ApiClientError('UNAUTHORIZED');
        const initialized = await initializeUser(writeToken, controller.signal);
        if (cancelled()) return;
        const readToken = await getToken();
        if (cancelled()) return;
        if (!readToken) throw new ApiClientError('UNAUTHORIZED');
        const persisted = await getCurrentUser(readToken, controller.signal);
        if (cancelled()) return;
        if (
          initialized.id !== persisted.id ||
          initialized.clerkUserId !== persisted.clerkUserId
        )
          throw new ApiClientError('INVALID_RESPONSE');
        setState({status: 'ready'});
      } catch (error) {
        if (cancelled()) return;
        setState({
          status: 'error',
          error:
            error instanceof ApiClientError
              ? error
              : new ApiClientError('REQUEST_FAILED', true),
        });
      }
    };
    void sync();
    return () => {
      controller.abort();
    };
  }, [attempt, getToken]);

  if (state.status === 'loading')
    return (
      <p role="status" className="my-10 text-leaf">
        Getting your account ready…
      </p>
    );
  if (state.status === 'error')
    return (
      <section
        className="my-10 rounded-2xl border border-outline p-5"
        aria-label="Account connection"
      >
        <p role="alert">{state.error.message}</p>
        <button
          type="button"
          className="mt-5 rounded-lg bg-leaf px-4 py-2 font-semibold text-forest focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-leaf"
          onClick={() => {
            if (state.error.code === 'UNAUTHORIZED') {
              void signInAgain().catch(() => {
                setState({
                  status: 'error',
                  error: new ApiClientError('NETWORK_ERROR', true),
                });
              });
            } else {
              setState({status: 'loading'});
              setAttempt(value => value + 1);
            }
          }}
        >
          {state.error.code === 'UNAUTHORIZED' ? 'Sign in again' : 'Try again'}
        </button>
      </section>
    );
  return (
    <>
      <p role="status" className="my-6 text-sm text-leaf">
        Account ready
      </p>
      {children}
    </>
  );
}
