import type { Attempt, Confidence, StatusKey } from '../db';
import { addDays, startOfDay, todayISO } from './dates';
import { weekKey, type Candidate } from './selection';
import { hasStatus } from './status';

export interface Agg {
  key: string;
  label: string;
  sub?: string;
  /** Answers given (attempts). */
  attempts: number;
  correct: number;
  questions: number;
  /** Questions answered at least once. */
  seenQuestions: number;
  accuracy: number | null;
}

function aggregate(cands: readonly Candidate[], keys: (c: Candidate) => { key: string; label: string; sub?: string }[]): Agg[] {
  const out = new Map<string, Agg>();
  for (const c of cands) {
    for (const { key, label, sub } of keys(c)) {
      const a = out.get(key) ?? { key, label, sub, attempts: 0, correct: 0, questions: 0, seenQuestions: 0, accuracy: null };
      a.questions++;
      if (c.progress?.timesSeen) {
        a.seenQuestions++;
        a.attempts += c.progress.timesSeen;
        a.correct += c.progress.timesCorrect;
      }
      out.set(key, a);
    }
  }
  return [...out.values()].map((a) => ({ ...a, accuracy: a.attempts ? a.correct / a.attempts : null }));
}

export const byLecture = (cands: readonly Candidate[]) =>
  aggregate(cands, (c) => [{ key: c.q.lecture_id, label: c.lecture?.title ?? c.q.lecture_id, sub: c.lecture?.day_label }]);

export const byWeek = (cands: readonly Candidate[]) =>
  aggregate(cands, (c) => (c.lecture ? [{ key: weekKey(c.lecture.course, c.lecture.week), label: `Week ${c.lecture.week}`, sub: c.lecture.course }] : []));

export const byTag = (cands: readonly Candidate[]) =>
  aggregate(cands, (c) => [...new Set(c.q.tags.map((t) => t.toLowerCase()))].map((t) => ({ key: t, label: t })));

/** Lowest accuracy among groups with enough answers to mean something. */
export function weakest(aggs: readonly Agg[], n = 5, minAttempts = 3): Agg[] {
  return aggs
    .filter((a) => a.accuracy !== null && a.attempts >= minAttempts)
    .sort((a, b) => a.accuracy! - b.accuracy! || b.attempts - a.attempts)
    .slice(0, n);
}

export function calibration(attempts: readonly Attempt[]): { confidence: Confidence; n: number; correct: number; accuracy: number | null }[] {
  return (['sure', 'unsure', 'guess'] as Confidence[]).map((confidence) => {
    const xs = attempts.filter((a) => a.confidence === confidence);
    const correct = xs.filter((a) => a.correct).length;
    return { confidence, n: xs.length, correct, accuracy: xs.length ? correct / xs.length : null };
  });
}

export interface DayPoint {
  date: string;
  n: number;
  correct: number;
  accuracy: number | null;
  /** Accuracy over the trailing 7 days (answer-weighted). */
  rolling: number | null;
}

export function dailyTrend(attempts: readonly Attempt[], days: number, now = Date.now()): DayPoint[] {
  const first = addDays(now, -(days - 1));
  const buckets = new Map<string, { n: number; correct: number }>();
  for (const a of attempts) {
    if (a.ts < addDays(first, -6)) continue;
    const d = todayISO(a.ts);
    const b = buckets.get(d) ?? { n: 0, correct: 0 };
    b.n++;
    if (a.correct) b.correct++;
    buckets.set(d, b);
  }
  const points: DayPoint[] = [];
  for (let i = -6; i < days; i++) {
    const t = addDays(first, i);
    const date = todayISO(t);
    const b = buckets.get(date) ?? { n: 0, correct: 0 };
    let rn = 0;
    let rc = 0;
    for (let k = 0; k < 7; k++) {
      const bb = buckets.get(todayISO(addDays(t, -k)));
      if (bb) {
        rn += bb.n;
        rc += bb.correct;
      }
    }
    if (i >= 0) points.push({ date, n: b.n, correct: b.correct, accuracy: b.n ? b.correct / b.n : null, rolling: rn ? rc / rn : null });
  }
  return points;
}

export function statusCounts(cands: readonly Candidate[], now: number): Record<StatusKey, number> {
  const keys: StatusKey[] = ['unseen', 'missed', 'ever_missed', 'lucky', 'flagged', 'due', 'mastered', 'reported'];
  return Object.fromEntries(keys.map((k) => [k, cands.filter((c) => hasStatus(c.progress, k, now)).length])) as Record<StatusKey, number>;
}

/** Number of distinct days (ending today or yesterday) with at least one answer. */
export function streakDays(attempts: readonly Attempt[], now = Date.now()): number {
  const days = new Set(attempts.map((a) => todayISO(a.ts)));
  // Today doesn't break the streak until it's over.
  let d = days.has(todayISO(now)) ? startOfDay(now) : addDays(now, -1);
  let n = 0;
  for (; days.has(todayISO(d)); d = addDays(d, -1)) n++;
  return n;
}
