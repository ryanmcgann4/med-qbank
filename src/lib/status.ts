import type { Progress, StatusKey } from '../db';
import { isDue, MASTERED_BOX } from './srs';

export const STATUS_LABELS: Record<StatusKey, string> = {
  unseen: 'Unseen',
  missed: 'Missed (last attempt)',
  ever_missed: 'Ever missed',
  lucky: 'Lucky guess',
  flagged: 'Flagged',
  due: 'Due for review',
  mastered: 'Mastered',
  reported: 'Reported issue',
};

export function hasStatus(p: Progress | undefined, key: StatusKey, now: number): boolean {
  const seen = !!p && p.timesSeen > 0;
  switch (key) {
    case 'unseen':
      return !seen;
    case 'missed':
      return seen && p!.lastResult === 'wrong';
    case 'ever_missed':
      return seen && p!.timesCorrect < p!.timesSeen;
    case 'lucky':
      return seen && p!.lastResult === 'correct' && p!.lastConfidence === 'guess';
    case 'flagged':
      return !!p?.flagged;
    case 'due':
      return seen && isDue(p!.srs, now);
    case 'mastered':
      return seen && p!.lastResult === 'correct' && (p!.srs?.box ?? 0) >= MASTERED_BOX;
    case 'reported':
      return !!p?.report;
  }
}

export function statusesOf(p: Progress | undefined, now: number): StatusKey[] {
  return (Object.keys(STATUS_LABELS) as StatusKey[]).filter((k) => hasStatus(p, k, now));
}

export function accuracy(p: Progress | undefined): number | null {
  return p && p.timesSeen > 0 ? p.timesCorrect / p.timesSeen : null;
}
