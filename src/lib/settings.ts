import { db as defaultDb, type Progress, type QBankDB } from '../db';

/** Misses before a question counts as a leech and archiving it is suggested. 0 = off. */
export const LEECH_KEY = 'leechThreshold';
export const DEFAULT_LEECH = 5;
export const LEECH_CHOICES = [0, 2, 3, 4, 5, 6, 8, 10, 15] as const;

export async function setSetting(key: string, value: unknown, database: QBankDB = defaultDb): Promise<void> {
  await database.settings.put({ key, value, updatedAt: Date.now() });
}

export async function getSetting<T>(key: string, fallback: T, database: QBankDB = defaultDb): Promise<T> {
  const row = await database.settings.get(key);
  return row === undefined ? fallback : (row.value as T);
}

/** Times you've gotten this question wrong (blank exam answers don't count; they aren't recorded). */
export const missCount = (p: Progress | null | undefined) => (p ? p.timesSeen - p.timesCorrect : 0);

/** Missed at least `threshold` times (archived or not). */
export const reachedLeech = (p: Progress | null | undefined, threshold: number) => threshold > 0 && missCount(p) >= threshold;

/** A leech you haven't archived yet. */
export const isLeech = (p: Progress | null | undefined, threshold: number) => !p?.archived && reachedLeech(p, threshold);
