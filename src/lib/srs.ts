/**
 * Leitner-box scheduler. Deliberately simple:
 *
 *   Box:        1    2    3    4    5    6
 *   Wait (days) 1    3    7   14   30   60
 *
 *   ❌ Wrong            → box 1, back tomorrow
 *   ✅ Correct + Guess  → box 1, back tomorrow (a lucky guess isn't knowledge)
 *                         (so is any answer given after opening the hint)
 *   ✅ Correct + Unsure → stay in the same box, wait HALF that box's interval
 *   ✅ Correct + Sure   → move up one box, wait the new box's interval
 *                         (answering before it's due doesn't promote; it just
 *                          re-waits the current box's interval)
 *
 * New questions start in box 1. "Mastered" = box 4+, which takes three
 * spaced, confident correct answers in a row.
 */
import type { Confidence, SrsState } from '../db';
import { addDays } from './dates';

export const BOX_INTERVAL_DAYS = [0, 1, 3, 7, 14, 30, 60] as const;
export const MAX_BOX = 6;
export const MASTERED_BOX = 4;

export function isDue(srs: SrsState | null | undefined, now: number): boolean {
  return !!srs && srs.dueAt <= now;
}

export function schedule(
  prev: SrsState | null | undefined,
  correct: boolean,
  confidence: Confidence | null,
  now: number,
): SrsState {
  const box = prev?.box ?? 1;

  if (!correct || confidence === 'guess') {
    return { box: 1, dueAt: addDays(now, 1), lastReviewedAt: now };
  }

  if (confidence === 'unsure') {
    const wait = Math.max(1, Math.ceil(BOX_INTERVAL_DAYS[box] / 2));
    return { box, dueAt: addDays(now, wait), lastReviewedAt: now };
  }

  // Sure (or no confidence given — treated as sure).
  if (!prev || isDue(prev, now)) {
    const next = Math.min(box + 1, MAX_BOX);
    return { box: next, dueAt: addDays(now, BOX_INTERVAL_DAYS[next]), lastReviewedAt: now };
  }
  return { box, dueAt: Math.max(prev.dueAt, addDays(now, BOX_INTERVAL_DAYS[box])), lastReviewedAt: now };
}
