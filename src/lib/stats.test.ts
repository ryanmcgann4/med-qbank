import { describe, expect, it } from 'vitest';
import { emptyProgress, type Attempt, type StoredLecture, type StoredQuestion } from '../db';
import { makeQuestion } from '../test/fixtures';
import { ankiCsv } from './anki';
import { addDays } from './dates';
import { applyEdit, revertEdit } from './edit';
import { contentHash } from './hash';
import type { Candidate } from './selection';
import { byLecture, byTag, byWeek, calibration, dailyTrend, streakDays, weakest } from './stats';

const NOW = new Date(2026, 9, 20, 15).getTime();

const lec = (id: string, week: number): StoredLecture => ({
  lecture_id: id,
  title: `Lecture ${id}`,
  lecturer: '',
  summary: '',
  learning_objectives: [],
  course: 'Block 2',
  week,
  day_label: `Week ${week} – Day 1`,
  date: '2026-10-05',
  importedAt: 0,
});

const stored = (over = {}): StoredQuestion => {
  const q = makeQuestion(over);
  return { ...q, hash: contentHash(q), importedAt: 0, updatedAt: 0, editedAt: null };
};

const cand = (qid: string, lecture: StoredLecture, seen: number, correct: number, tags = ['renal']): Candidate => ({
  q: stored({ qid, lecture_id: lecture.lecture_id, tags }),
  lecture,
  progress: seen ? { ...emptyProgress(qid), timesSeen: seen, timesCorrect: correct, lastResult: 'correct' } : undefined,
});

describe('stats', () => {
  const L1 = lec('L1', 6);
  const L2 = lec('L2', 7);
  const cands = [cand('a', L1, 4, 1, ['renal', 'Acid-Base']), cand('b', L1, 0, 0), cand('c', L2, 4, 4, ['cardio']), cand('d', L2, 2, 2, ['cardio'])];

  it('aggregates accuracy by lecture, week, and tag (answer-weighted)', () => {
    expect(byLecture(cands).map((a) => [a.key, a.questions, a.seenQuestions, a.accuracy])).toEqual([
      ['L1', 2, 1, 0.25],
      ['L2', 2, 2, 1],
    ]);
    expect(byWeek(cands).map((a) => a.label)).toEqual(['Week 6', 'Week 7']);
    expect(byTag(cands).find((t) => t.key === 'acid-base')?.accuracy).toBe(0.25);
  });

  it('weakest ignores groups with too few answers', () => {
    expect(weakest(byLecture(cands), 5, 3).map((a) => a.key)).toEqual(['L1', 'L2']);
    expect(weakest(byTag(cands), 5, 5).map((a) => a.key)).toEqual(['cardio']);
  });

  it('calibration and daily trend', () => {
    const at = (ts: number, correct: boolean, confidence: Attempt['confidence']): Attempt => ({
      qid: 'a', ts, correct, confidence, chosen: 'A', timeMs: 0, mode: 'smart', sessionId: 's',
    });
    const attempts = [at(NOW, true, 'sure'), at(NOW, true, 'sure'), at(NOW, false, 'guess'), at(addDays(NOW, -2) + 3600e3, false, 'unsure')];
    expect(calibration(attempts)).toEqual([
      { confidence: 'sure', n: 2, correct: 2, accuracy: 1 },
      { confidence: 'unsure', n: 1, correct: 0, accuracy: 0 },
      { confidence: 'guess', n: 1, correct: 0, accuracy: 0 },
    ]);
    const trend = dailyTrend(attempts, 7, NOW);
    expect(trend).toHaveLength(7);
    expect(trend[6]).toMatchObject({ n: 3, correct: 2 });
    expect(trend[6].rolling).toBeCloseTo(0.5);
    expect(trend[4]).toMatchObject({ n: 1, accuracy: 0 });
    expect(trend[5]).toMatchObject({ n: 0, accuracy: null });
    expect(streakDays(attempts, NOW)).toBe(1);
  });
});

describe('anki export', () => {
  it('writes Anki headers, escapes HTML and quotes, and adds tags', () => {
    const q = stored({ stem: 'Na+ < K+ "really"?\nNext line', tags: ['renal phys'] });
    const csv = ankiCsv([{ q, lecture: lec('T-W1-D1-L1', 1) }], 'Block 2');
    const lines = csv.trim().split('\n');
    expect(lines.slice(0, 6)).toEqual(['#separator:Comma', '#html:true', '#notetype:Basic', '#deck:Block 2', '#tags column:3', '#columns:Front,Back,Tags']);
    const row = lines[6];
    expect(row).toContain('Na+ &lt; K+ ""really""?<br>Next line');
    expect(row).toContain('<b>Answer: A. Sodium</b>');
    expect(row).toContain('Key takeaway');
    expect(row).toContain('slides 1');
    expect(row).toMatch(/"qbank qbank::Block_2::W1 qbank::T-W1-D1-L1 renal_phys"$/);
  });
});

describe('in-app edits', () => {
  it('marks edits, recomputes the hash, keeps the original, and can revert', () => {
    const q = stored();
    const edited = applyEdit(q, { ...q, stem: 'Fixed stem', correct_option: 'B' }, 123);
    expect(edited).toMatchObject({ stem: 'Fixed stem', correct_option: 'B', editedAt: 123 });
    expect(edited.hash).not.toBe(q.hash);
    expect(edited.original?.stem).toBe(q.stem);

    const twice = applyEdit(edited, { ...edited, stem: 'Again' }, 456);
    expect(twice.original?.stem).toBe(q.stem); // still the imported version

    const back = revertEdit(twice);
    expect(back).toMatchObject({ stem: q.stem, correct_option: 'A', editedAt: null, original: null, hash: q.hash });
  });

  it('rejects an invalid edit', () => {
    const q = stored();
    expect(() => applyEdit(q, { ...q, correct_option: 'Z' })).toThrow(/correct_option/);
    expect(() => applyEdit(q, { ...q, stem: '  ' })).toThrow(/stem/);
  });
});
