import { describe, expect, it } from 'vitest';
import { emptyProgress, type Progress, type QuizConfig, type StoredLecture } from '../db';
import { makeQuestion } from '../test/fixtures';
import { addDays, DAY_MS } from './dates';
import { contentHash } from './hash';
import { mulberry32 } from './rng';
import { buildSession, dayKey, defaultConfig, eligiblePool, selectQuestions, smartOrder, weekKey, type Candidate } from './selection';

const NOW = new Date(2026, 9, 12, 10, 0).getTime();

const lec = (id: string, week: number, course = 'Block 2'): StoredLecture => ({
  lecture_id: id,
  title: id,
  lecturer: '',
  summary: '',
  learning_objectives: [],
  course,
  week,
  day_label: `Week ${week} – Day 1`,
  date: '2026-10-05',
  importedAt: 0,
});

function cand(qid: string, opts: { lecture?: StoredLecture; progress?: Partial<Progress>; tags?: string[]; difficulty?: number } = {}): Candidate {
  const lecture = opts.lecture ?? lec('L1', 6);
  const q = makeQuestion({ qid, lecture_id: lecture.lecture_id, stem: `stem ${qid}`, tags: opts.tags ?? ['renal'], difficulty: opts.difficulty ?? 3 });
  return {
    q: { ...q, hash: contentHash(q), importedAt: 0, updatedAt: 0, editedAt: null },
    lecture,
    progress: opts.progress ? { ...emptyProgress(qid), ...opts.progress } : undefined,
  };
}

const seen = (over: Partial<Progress>): Partial<Progress> => ({ timesSeen: 1, lastAnsweredAt: NOW - 10 * DAY_MS, ...over });
const due = (box = 2) => ({ box, dueAt: addDays(NOW, -1), lastReviewedAt: 0 });
const notDue = (box = 2) => ({ box, dueAt: addDays(NOW, 5), lastReviewedAt: 0 });

const cfg = (over: Partial<QuizConfig> = {}): QuizConfig => ({ ...defaultConfig(), ...over });
const ids = (cs: Candidate[]) => cs.map((c) => c.q.qid);

describe('filters and modes', () => {
  const L6 = lec('B2-W6-D1-L1', 6);
  const L7 = lec('B2-W7-D1-L1', 7);
  const pool = [
    cand('unseen-6', { lecture: L6, tags: ['cardio'], difficulty: 1 }),
    cand('missed-6', { lecture: L6, progress: seen({ lastResult: 'wrong', srs: notDue(1) }) }),
    cand('right-7', { lecture: L7, progress: seen({ lastResult: 'correct', timesCorrect: 1, srs: notDue(3) }) }),
    cand('flagged-7', { lecture: L7, progress: { flagged: true } }),
  ];

  it('filters by week, tag, difficulty and status', () => {
    const f = defaultConfig().filters;
    expect(ids(eligiblePool(pool, cfg({ filters: { ...f, weeks: [weekKey('Block 2', 7)] } }), NOW))).toEqual(['right-7', 'flagged-7']);
    expect(ids(eligiblePool(pool, cfg({ filters: { ...f, tags: ['CARDIO'] } }), NOW))).toEqual(['unseen-6']);
    expect(ids(eligiblePool(pool, cfg({ filters: { ...f, difficulties: [1] } }), NOW))).toEqual(['unseen-6']);
    expect(ids(eligiblePool(pool, cfg({ filters: { ...f, statuses: ['flagged', 'missed'] } }), NOW))).toEqual(['missed-6', 'flagged-7']);
    expect(ids(eligiblePool(pool, cfg({ filters: { ...f, days: [dayKey('Block 2', 'Week 6 – Day 1')] } }), NOW))).toEqual(['unseen-6', 'missed-6']);
  });

  it('unseen mode and missed mode', () => {
    expect(ids(eligiblePool(pool, cfg({ mode: 'unseen' }), NOW))).toEqual(['unseen-6', 'flagged-7']);
    expect(ids(eligiblePool(pool, cfg({ mode: 'missed' }), NOW))).toEqual(['missed-6']);
  });
});

describe('repeat avoidance', () => {
  const recentRight = cand('recent', { progress: seen({ lastResult: 'correct', timesCorrect: 1, lastAnsweredAt: NOW - DAY_MS, srs: notDue() }) });
  const recentButDue = cand('due', { progress: seen({ lastResult: 'correct', timesCorrect: 1, lastAnsweredAt: NOW - DAY_MS, srs: due() }) });
  const oldRight = cand('old', { progress: seen({ lastResult: 'correct', timesCorrect: 1, lastAnsweredAt: NOW - 5 * DAY_MS, srs: notDue() }) });

  it('skips questions answered correctly in the last N days, except due ones', () => {
    expect(ids(eligiblePool([recentRight, recentButDue, oldRight], cfg({ avoidRecentDays: 3 }), NOW))).toEqual(['due', 'old']);
  });

  it('includes them when asked', () => {
    expect(eligiblePool([recentRight, oldRight], cfg({ includeRecentCorrect: true }), NOW)).toHaveLength(2);
    expect(eligiblePool([recentRight, oldRight], cfg({ avoidRecentDays: 0 }), NOW)).toHaveLength(2);
  });
});

describe('smart mix', () => {
  it('orders due → missed → unseen → rest (weakest first)', () => {
    const pool = [
      cand('strong', { progress: seen({ lastResult: 'correct', timesSeen: 4, timesCorrect: 4, srs: notDue(4) }) }),
      cand('unseen'),
      cand('weak', { progress: seen({ lastResult: 'correct', timesSeen: 4, timesCorrect: 1, srs: notDue(2) }) }),
      cand('missed', { progress: seen({ lastResult: 'wrong', srs: notDue(1) }) }),
      cand('due-later', { progress: seen({ lastResult: 'correct', timesCorrect: 1, srs: { ...due(), dueAt: addDays(NOW, 0) } }) }),
      cand('due-overdue', { progress: seen({ lastResult: 'correct', timesCorrect: 1, srs: { ...due(), dueAt: addDays(NOW, -4) } }) }),
    ];
    expect(ids(smartOrder(pool, NOW, mulberry32(1)))).toEqual(['due-overdue', 'due-later', 'missed', 'unseen', 'weak', 'strong']);
  });

  it('takes the top N by priority, then shuffles their order', () => {
    const pool = [
      ...Array.from({ length: 5 }, (_, i) => cand(`unseen${i}`)),
      cand('due', { progress: seen({ lastResult: 'correct', timesCorrect: 1, srs: due() }) }),
      cand('missed', { progress: seen({ lastResult: 'wrong', srs: notDue(1) }) }),
    ];
    const picked = ids(selectQuestions(pool, cfg({ count: 3 }), NOW, mulberry32(7)));
    expect(picked).toHaveLength(3);
    expect(picked).toContain('due');
    expect(picked).toContain('missed');
  });
});

describe('weekly review', () => {
  it('draws weak questions more often than mastered ones', () => {
    const weak = Array.from({ length: 10 }, (_, i) =>
      cand(`weak${i}`, { lecture: lec('weakLec', 6), progress: seen({ lastResult: 'wrong', timesSeen: 3, timesCorrect: 0, lastConfidence: 'guess', srs: notDue(1) }) }),
    );
    const strong = Array.from({ length: 10 }, (_, i) =>
      cand(`strong${i}`, { lecture: lec('strongLec', 6), progress: seen({ lastResult: 'correct', timesSeen: 3, timesCorrect: 3, srs: notDue(5) }) }),
    );
    let weakPicks = 0;
    const rng = mulberry32(42);
    for (let trial = 0; trial < 200; trial++) {
      const picked = selectQuestions([...weak, ...strong], cfg({ mode: 'weekly', count: 5 }), NOW, rng);
      weakPicks += picked.filter((c) => c.q.qid.startsWith('weak')).length;
    }
    expect(weakPicks / (200 * 5)).toBeGreaterThan(0.8);
  });
});

describe('sessions', () => {
  it('uses an explicit qid list (re-quiz) and ignores filters', () => {
    const pool = [cand('a'), cand('b'), cand('c')];
    const picked = selectQuestions(pool, cfg({ qids: ['c', 'a', 'missing'], filters: { ...defaultConfig().filters, tags: ['nope'] } }), NOW, mulberry32(3));
    expect(ids(picked).sort()).toEqual(['a', 'c']);
  });

  it('shuffles option order but keeps original ids; exam mode gets 90 s per question', () => {
    const pool = Array.from({ length: 4 }, (_, i) => cand(`q${i}`));
    const s = buildSession(pool, cfg({ mode: 'exam' }), NOW, mulberry32(9));
    expect(s.timed).toBe(true);
    expect(s.timeLimitMs).toBe(4 * 90 * 1000);
    for (const item of s.items) expect([...item.order].sort()).toEqual(['A', 'B', 'C']);
    expect(s.items.some((it) => it.order.join('') !== 'ABC')).toBe(true);
    const noShuffle = buildSession(pool, cfg({ shuffleOptions: false }), NOW, mulberry32(9));
    expect(noShuffle.items.every((it) => it.order.join('') === 'ABC')).toBe(true);
    expect(noShuffle.timeLimitMs).toBeNull();
  });
});
