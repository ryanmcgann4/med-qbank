import { describe, expect, it } from 'vitest';
import { emptyProgress, type Attempt, type Exam, type StoredLecture } from '../db';
import { makeQuestion } from '../test/fixtures';
import { buildAskPrompt, claudeUrl } from './askClaude';
import { addDays } from './dates';
import { inExam, planFor, releasedByExams, releaseDate, reviewDays } from './exams';
import { contentHash } from './hash';
import type { Candidate } from './selection';

const NOW = new Date(2026, 9, 5, 15).getTime(); // Mon Oct 5, 3pm
const lec = (week: number, course = 'Block 2'): StoredLecture => ({
  lecture_id: `L-W${week}`,
  title: `Week ${week} lecture`,
  lecturer: '',
  summary: '',
  learning_objectives: [],
  course,
  week,
  day_label: `Week ${week} – Day 1`,
  date: '2026-10-01',
  importedAt: 0,
});
const cand = (qid: string, lecture: StoredLecture, progress?: Partial<ReturnType<typeof emptyProgress>>): Candidate => {
  const q = makeQuestion({ qid, lecture_id: lecture.lecture_id, stem: `stem ${qid}` });
  return { q: { ...q, hash: contentHash(q), importedAt: 0, updatedAt: 0, editedAt: null }, lecture, progress: progress ? { ...emptyProgress(qid), ...progress } : undefined };
};
const exam = (over: Partial<Exam> = {}): Exam => ({ id: 'e', name: 'Block 2 exam', date: '2026-10-15', course: 'Block 2', weeks: [], updatedAt: 0, ...over });
const att = (qid: string, ts: number, correct = true): Attempt => ({ qid, ts, correct, chosen: 'A', confidence: 'sure', timeMs: 0, mode: 'smart', sessionId: 's' });

describe('exam plan', () => {
  const W6 = lec(6);
  const W7 = lec(7);
  const other = lec(6, 'Doctoring');

  it('scopes to the course and chosen weeks', () => {
    expect(inExam(cand('a', W6), exam())).toBe(true);
    expect(inExam(cand('a', other), exam())).toBe(false);
    expect(inExam(cand('a', W7), exam({ weeks: ['Block 2::6'] }))).toBe(false);
  });

  it('spreads unseen questions over the days left, holding back review days', () => {
    // 10 days to the exam → 2 review days → 8 days for 40 new questions → 5/day.
    const pool = Array.from({ length: 40 }, (_, i) => cand(`q${i}`, W6));
    const p = planFor(exam(), pool, [], NOW);
    expect(p.daysLeft).toBe(10);
    expect(reviewDays(10)).toBe(2);
    expect(p).toMatchObject({ total: 40, seen: 0, newTarget: 5, newDone: 0, remaining: 5, firstPassBy: '2026-10-12' });
    expect(p.todayQids).toHaveLength(5);
  });

  it("counts today's work without shrinking the target, and includes due reviews", () => {
    const dueSrs = { box: 2, dueAt: addDays(NOW, -1), lastReviewedAt: 0 };
    const pool = [
      ...Array.from({ length: 38 }, (_, i) => cand(`q${i}`, W6)),
      // Two answered for the first time today: still part of today's target.
      cand('new1', W6, { timesSeen: 1, timesCorrect: 1, lastResult: 'correct', srs: { box: 2, dueAt: addDays(NOW, 3), lastReviewedAt: NOW } }),
      cand('new2', W6, { timesSeen: 1, timesCorrect: 1, lastResult: 'correct', srs: { box: 2, dueAt: addDays(NOW, 3), lastReviewedAt: NOW } }),
      // Seen last week and due now.
      cand('due1', W6, { timesSeen: 1, timesCorrect: 0, lastResult: 'wrong', srs: dueSrs }),
    ];
    const attempts = [att('new1', NOW - 3600e3), att('new2', NOW - 1800e3), att('due1', addDays(NOW, -6), false)];
    const p = planFor(exam(), pool, attempts, NOW);
    expect(p).toMatchObject({ newTarget: 5, newDone: 2, reviewTarget: 1, reviewDone: 0, remaining: 4 });
    expect(p.todayQids[0]).toBe('due1');
    expect(p.recentAccuracy).toBe(2 / 3);
  });

  it('no new questions on exam day; everything left is review', () => {
    const p = planFor(exam({ date: '2026-10-05' }), [cand('a', W6)], [], NOW);
    expect(p).toMatchObject({ daysLeft: 0, newTarget: 0, remaining: 0 });
  });
});

describe('ask Claude prompt', () => {
  it('uses the letters you saw, marks your answer and the correct one, and ends with your question', () => {
    const q = makeQuestion();
    const c = cand('x', lec(6));
    const prompt = buildAskPrompt({ ...c.q, ...q }, lec(6), ['C', 'A', 'B'], { chosen: 'B', confidence: 'sure' }, 'Why not calcium?');
    expect(prompt).toContain('B. Sodium [correct]');
    expect(prompt).toContain('C. Calcium [my answer]');
    expect(prompt).toContain('I chose C (I felt sure); the correct answer is B.');
    expect(prompt).toContain('"Week 6 lecture", slides 1');
    expect(prompt.trim().endsWith('Why not calcium?')).toBe(true);
    expect(claudeUrl('a b&c')).toBe('https://claude.ai/new?q=a%20b%26c');
  });
});

describe('exam plan with new questions first', () => {
  const W6 = lec(6);
  const dueSrs = { box: 2, dueAt: addDays(NOW, -1), lastReviewedAt: 0 };
  const right = cand('right', W6, { timesSeen: 1, timesCorrect: 1, lastResult: 'correct', lastAnsweredAt: NOW - 5 * 864e5, srs: dueSrs });
  const wrong = cand('wrong', W6, { timesSeen: 1, lastResult: 'wrong', lastAnsweredAt: NOW - 5 * 864e5, srs: { ...dueSrs, box: 1 } });

  it('holds reviews of questions you got right while the exam still has unseen ones', () => {
    const p = planFor(exam(), [right, wrong, cand('n1', W6), cand('n2', W6)], [], NOW, { newFirst: true });
    expect(p.held).toBe(1);
    expect(p.reviewTarget).toBe(1);
    expect(p.todayQids).toContain('wrong');
    expect(p.todayQids).not.toContain('right');
  });

  it('in the last 7 days before the exam, its reviews come back even with unseen ones left', () => {
    const cands = [right, wrong, cand('n1', W6)];
    expect(planFor(exam({ date: '2026-10-13' }), cands, [], NOW, { newFirst: true })).toMatchObject({ held: 1 }); // 8 days out
    expect(planFor(exam({ date: '2026-10-12' }), cands, [], NOW, { newFirst: true })).toMatchObject({ held: 0, reviewTarget: 2 }); // 7 days out
    expect(releaseDate(exam({ date: '2026-10-29' }))).toBe('2026-10-22');
  });

  it('quizzes release only the questions in an exam less than a week away', () => {
    const released = releasedByExams([exam({ date: '2026-10-12', weeks: ['Block 2::6'] })], NOW);
    expect(released(right)).toBe(true);
    expect(released(cand('w7', lec(7)))).toBe(false);
    expect(releasedByExams([exam({ date: '2026-10-20' })], NOW)(right)).toBe(false);
  });

  it('brings them back once every question has been seen, or with the setting off', () => {
    expect(planFor(exam(), [right, wrong], [], NOW, { newFirst: true })).toMatchObject({ held: 0, reviewTarget: 2 });
    expect(planFor(exam(), [right, wrong, cand('n1', W6)], [], NOW)).toMatchObject({ held: 0, reviewTarget: 2 });
  });
});

