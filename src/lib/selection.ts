import type { Progress, QuizConfig, QuizFilters, QuizMode, QuizSession, StoredLecture, StoredQuestion } from '../db';
import { DAY_MS } from './dates';
import { randomId, shuffle, weightedSample, type Rng } from './rng';
import { accuracy, hasStatus } from './status';

/** A question joined with its lecture and your progress on it. */
export interface Candidate {
  q: StoredQuestion;
  lecture?: StoredLecture;
  progress?: Progress;
}

export const weekKey = (course: string, week: number) => `${course}::${week}`;
export const dayKey = (course: string, dayLabel: string) => `${course}::${dayLabel}`;

export const MODE_LABELS: Record<QuizMode, string> = {
  smart: 'Smart mix',
  unseen: 'Unseen only',
  missed: 'Redemption run',
  weekly: 'Weekly review',
  exam: 'Exam simulation',
  custom: 'Custom set',
};

export function emptyFilters(): QuizFilters {
  return { courses: [], weeks: [], days: [], lectures: [], tags: [], types: [], difficulties: [], statuses: [] };
}

export function defaultConfig(): QuizConfig {
  return {
    mode: 'smart',
    count: 20,
    filters: emptyFilters(),
    avoidRecentDays: 3,
    includeRecentCorrect: false,
    shuffleOptions: true,
    secondsPerQuestion: 90,
  };
}

export function matchesFilters(c: Candidate, f: QuizFilters, now: number): boolean {
  const l = c.lecture;
  if (f.courses.length && !(l && f.courses.includes(l.course))) return false;
  if (f.weeks.length && !(l && f.weeks.includes(weekKey(l.course, l.week)))) return false;
  if (f.days.length && !(l && f.days.includes(dayKey(l.course, l.day_label)))) return false;
  if (f.lectures.length && !f.lectures.includes(c.q.lecture_id)) return false;
  if (f.tags.length) {
    const tags = c.q.tags.map((t) => t.toLowerCase());
    if (!f.tags.some((t) => tags.includes(t.toLowerCase()))) return false;
  }
  if (f.types.length && !f.types.includes(c.q.type)) return false;
  if (f.difficulties.length && !f.difficulties.includes(c.q.difficulty)) return false;
  if (f.statuses.length && !f.statuses.some((s) => hasStatus(c.progress, s, now))) return false;
  return true;
}

export function isRecentlyCorrect(p: Progress | undefined, days: number, now: number): boolean {
  return !!p && days > 0 && p.lastResult === 'correct' && p.lastAnsweredAt !== null && now - p.lastAnsweredAt < days * DAY_MS;
}

/** Questions that pass the filters, the mode's eligibility rule, and the repeat-avoidance window. */
export function eligiblePool(cands: readonly Candidate[], config: QuizConfig, now: number): Candidate[] {
  let pool = cands.filter((c) => matchesFilters(c, config.filters, now));
  if (config.mode === 'unseen') pool = pool.filter((c) => hasStatus(c.progress, 'unseen', now));
  if (config.mode === 'missed') pool = pool.filter((c) => hasStatus(c.progress, 'missed', now));
  if (!config.includeRecentCorrect && config.avoidRecentDays > 0) {
    // Due questions are exempt: the scheduler wants them back.
    pool = pool.filter(
      (c) => !isRecentlyCorrect(c.progress, config.avoidRecentDays, now) || hasStatus(c.progress, 'due', now),
    );
  }
  return pool;
}

/** Smart mix priority: due (most overdue first) → missed → unseen → everything else (weakest first). */
export function smartOrder(pool: readonly Candidate[], now: number, rng: Rng): Candidate[] {
  const due: Candidate[] = [];
  const missed: Candidate[] = [];
  const unseen: Candidate[] = [];
  const rest: Candidate[] = [];
  for (const c of shuffle(pool, rng)) {
    if (hasStatus(c.progress, 'due', now)) due.push(c);
    else if (hasStatus(c.progress, 'missed', now)) missed.push(c);
    else if (hasStatus(c.progress, 'unseen', now)) unseen.push(c);
    else rest.push(c);
  }
  due.sort((a, b) => a.progress!.srs!.dueAt - b.progress!.srs!.dueAt);
  rest.sort(
    (a, b) =>
      (accuracy(a.progress) ?? 1) - (accuracy(b.progress) ?? 1) ||
      (a.progress?.lastAnsweredAt ?? 0) - (b.progress?.lastAnsweredAt ?? 0),
  );
  return [...due, ...missed, ...unseen, ...rest];
}

/** Accuracy per lecture across the given candidates (only lectures with attempts). */
export function lectureAccuracy(cands: readonly Candidate[]): Map<string, number> {
  const sums = new Map<string, { seen: number; correct: number }>();
  for (const c of cands) {
    if (!c.progress?.timesSeen) continue;
    const s = sums.get(c.q.lecture_id) ?? { seen: 0, correct: 0 };
    s.seen += c.progress.timesSeen;
    s.correct += c.progress.timesCorrect;
    sums.set(c.q.lecture_id, s);
  }
  return new Map([...sums].map(([id, s]) => [id, s.correct / s.seen]));
}

/** Weekly review: weak questions and weak lectures are drawn more often. */
export function weaknessWeight(c: Candidate, lectureAcc: ReadonlyMap<string, number>, now: number): number {
  const p = c.progress;
  let w = 1;
  if (!p || p.timesSeen === 0) {
    w += 1;
  } else {
    w += 3 * (1 - (accuracy(p) ?? 0));
    if (p.lastResult === 'wrong') w += 2;
    if (p.lastConfidence === 'guess' || p.lastConfidence === 'unsure') w += 1;
    if (hasStatus(p, 'due', now)) w += 1;
  }
  const la = lectureAcc.get(c.q.lecture_id);
  if (la !== undefined) w += 2 * (1 - la);
  if (hasStatus(p, 'mastered', now)) w *= 0.3;
  return w;
}

export function selectQuestions(cands: readonly Candidate[], config: QuizConfig, now: number, rng: Rng = Math.random): Candidate[] {
  if (config.qids?.length) {
    const byId = new Map(cands.map((c) => [c.q.qid, c]));
    const picked = config.qids.map((id) => byId.get(id)).filter((c): c is Candidate => !!c);
    return shuffle(picked, rng);
  }
  const pool = eligiblePool(cands, config, now);
  const n = Math.max(0, Math.min(config.count, pool.length));
  let picked: Candidate[];
  if (config.mode === 'smart') {
    picked = smartOrder(pool, now, rng).slice(0, n);
  } else if (config.mode === 'weekly') {
    const la = lectureAccuracy(pool);
    picked = weightedSample(pool, (c) => weaknessWeight(c, la, now), n, rng);
  } else {
    picked = shuffle(pool, rng).slice(0, n);
  }
  return shuffle(picked, rng);
}

export function buildSession(picked: readonly Candidate[], config: QuizConfig, now: number, rng: Rng = Math.random, title?: string): QuizSession {
  const items = picked.map((c) => {
    const ids = c.q.options.map((o) => o.id);
    return { qid: c.q.qid, order: config.shuffleOptions ? shuffle(ids, rng) : ids };
  });
  const timed = config.mode === 'exam';
  return {
    id: randomId(),
    title: title ?? MODE_LABELS[config.mode],
    createdAt: now,
    mode: config.mode,
    timed,
    timeLimitMs: timed ? items.length * config.secondsPerQuestion * 1000 : null,
    config,
    items,
    answers: items.map(() => ({ chosen: null, confidence: null, timeMs: 0, struck: [], submitted: false, correct: null })),
    current: 0,
    elapsedMs: 0,
    finishedAt: null,
  };
}

/** Display letter for position i: 0 → A. */
export const letter = (i: number) => String.fromCharCode(65 + i);
