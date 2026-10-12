import { useLiveQuery } from 'dexie-react-hooks';
import { DEFAULT_LEECH, getSetting, LEECH_KEY } from '../lib/settings';

/** Your leech threshold (0 = off); the default until it has loaded. */
export function useLeechThreshold(): number {
  return useLiveQuery(() => getSetting<number>(LEECH_KEY, DEFAULT_LEECH), []) ?? DEFAULT_LEECH;
}
