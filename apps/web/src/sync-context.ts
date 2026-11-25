import {createContext, useContext} from 'react';
import type {SyncEngine, SyncState} from './sync-engine';

interface AccountSync {
  engine: SyncEngine;
  state: SyncState & {
    snapshot: NonNullable<SyncState['snapshot']>;
    view: NonNullable<SyncState['view']>;
  };
}

export const SyncContext = createContext<AccountSync | null>(null);

export function useAccountSync() {
  const account = useContext(SyncContext);
  if (!account) throw new Error('Account sync is unavailable.');
  return account;
}
