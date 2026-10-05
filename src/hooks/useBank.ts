import { useLiveQuery } from 'dexie-react-hooks';
import { loadCandidates } from '../lib/tracking';
import type { Candidate } from '../lib/selection';

/** Every question joined with its lecture and progress; re-renders on any change. */
export function useCandidates({ includeArchived = false } = {}): Candidate[] | undefined {
  return useLiveQuery(() => loadCandidates(undefined, { includeArchived }), [includeArchived]);
}
