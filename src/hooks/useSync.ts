import { useSyncExternalStore } from 'react';
import { getSyncState, subscribeSync, type SyncState } from '../lib/sync/controller';

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribeSync, getSyncState);
}
