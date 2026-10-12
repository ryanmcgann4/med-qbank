import { useLiveQuery } from 'dexie-react-hooks';
import { DEFAULT_LEECH, DEFAULT_NEW_FIRST, getSetting, LEECH_KEY, NEW_FIRST_KEY } from '../lib/settings';

/** Your leech threshold (0 = off); the default until it has loaded. */
export function useLeechThreshold(): number {
  return useLiveQuery(() => getSetting<number>(LEECH_KEY, DEFAULT_LEECH), []) ?? DEFAULT_LEECH;
}

/** Whether reviews of questions you got right wait until the unseen ones are done. */
export function useNewFirst(): boolean {
  return useLiveQuery(() => getSetting<boolean>(NEW_FIRST_KEY, DEFAULT_NEW_FIRST), []) ?? DEFAULT_NEW_FIRST;
}
