import '@vitejs/plugin-react/preamble';
import {createRoot} from 'react-dom/client';
import {FocusGameplay} from './focus-gameplay';
import {SyncContext} from './sync-context';
import type {SyncEngine} from './sync-engine';

// Mount the real Focus route content against the browser test's account engine.
export function mountFocus(engine: SyncEngine) {
  const state = engine.getState();
  if (!state.snapshot || !state.view)
    throw new Error('Expected cached account');
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  root.render(
    <SyncContext.Provider
      value={{
        engine,
        state: {...state, snapshot: state.snapshot, view: state.view},
      }}
    >
      <FocusGameplay />
    </SyncContext.Provider>,
  );
  return () => {
    root.unmount();
    container.remove();
  };
}
