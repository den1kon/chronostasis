import type {SyncOperation} from '@chronostasis/contracts';
import {
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {buttonStyle, secondaryButtonStyle} from './gameplay-styles';
import {SyncContext} from './sync-context';
import {createSyncEngine, type SyncEngine} from './sync-engine';

interface ConnectionProps {
  userId: string;
  getToken: () => Promise<string | null>;
  signInAgain: () => Promise<void>;
  children: ReactNode;
}

const operationLabels: Record<SyncOperation['type'], string> = {
  buy_chest: 'Chest purchase',
  start_session: 'Session start',
  claim_reward: 'Reward claim',
  cancel_session: 'Session cancellation',
  offline_session_claim: 'Offline reward',
};

const loading = (
  <p role="status" className="my-10 text-leaf">
    Getting your account ready…
  </p>
);

export function AccountGate({
  sessionId,
  ...props
}: ConnectionProps & {sessionId: string}) {
  // Remount immediately so a session or account switch cannot display the previous view.
  return (
    <AccountConnection
      key={JSON.stringify([props.userId, sessionId])}
      {...props}
    />
  );
}

function AccountConnection({
  userId,
  getToken,
  signInAgain,
  children,
}: ConnectionProps) {
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const getSessionToken = useEffectEvent(getToken);

  useEffect(() => {
    // Each effect owns a disposable engine, including the Strict Mode probe.
    const connection = createSyncEngine({
      userId,
      getToken: () => getSessionToken(),
    });
    let disposed = false;
    void connection.initialize().then(() => {
      if (!disposed) setEngine(connection);
    });
    return () => {
      disposed = true;
      connection.dispose();
    };
  }, [userId]);

  if (!engine) return loading;
  return (
    <AccountView engine={engine} signInAgain={signInAgain}>
      {children}
    </AccountView>
  );
}

function AccountView({
  engine,
  signInAgain,
  children,
}: {
  engine: SyncEngine;
  signInAgain: () => Promise<void>;
  children: ReactNode;
}) {
  const state = useSyncExternalStore(engine.subscribe, engine.getState);
  const [signInFailed, setSignInFailed] = useState(false);
  const {snapshot, view} = state;
  if (!state.initialized) return loading;
  if (state.unauthorized || !snapshot || !view) {
    const message = state.unauthorized
      ? 'Your session needs to be refreshed. Please sign in again.'
      : (state.error ?? 'Connect to download your account before playing.');
    return (
      <section
        className="my-10 rounded-2xl border border-outline p-5"
        aria-label="Account connection"
      >
        <p role="alert">{message}</p>
        {signInFailed && (
          <p role="alert" className="mt-2">
            Could not open sign-in. Please try again.
          </p>
        )}
        <button
          type="button"
          className={`mt-5 ${buttonStyle}`}
          disabled={state.syncing}
          onClick={() => {
            if (state.unauthorized) {
              setSignInFailed(false);
              void signInAgain().catch(() => {
                setSignInFailed(true);
              });
            } else {
              void engine.sync();
            }
          }}
        >
          {state.unauthorized ? 'Sign in again' : 'Try again'}
        </button>
      </section>
    );
  }

  const rejected = state.outcomes.filter(
    outcome => outcome.status === 'rejected',
  );
  return (
    <SyncContext.Provider value={{engine, state: {...state, snapshot, view}}}>
      <div className="my-6 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p role="status" className="text-leaf">
          {!state.online
            ? 'Offline'
            : state.syncing
              ? 'Syncing…'
              : 'Account ready'}
        </p>
        <button
          type="button"
          className={secondaryButtonStyle}
          disabled={state.syncing}
          onClick={() => {
            void engine.sync();
          }}
        >
          Sync now
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-parchment/85">
          {state.error}
        </p>
      )}
      {rejected.length > 0 && (
        <ul
          aria-label="Sync notices"
          className="my-4 space-y-2 rounded-xl border border-outline p-4 text-sm text-parchment/85"
        >
          {rejected.map(outcome => (
            <li
              key={outcome.operationId}
              role={outcome.retryable ? 'status' : 'alert'}
            >
              {operationLabels[outcome.type]}{' '}
              {outcome.retryable ? 'still pending.' : 'rejected.'}{' '}
              {outcome.message}
            </li>
          ))}
        </ul>
      )}
      {children}
    </SyncContext.Provider>
  );
}
