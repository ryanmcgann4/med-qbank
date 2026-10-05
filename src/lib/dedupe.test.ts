import { describe, expect, it } from 'vitest';
import { makeQuestion } from '../test/fixtures';
import { classifyQuestions, diffQuestion, diffWords, freeQid, sameContent, type ExistingQuestion } from './dedupe';
import { contentHash, normalizeText } from './hash';

const stored = (over = {}): ExistingQuestion => {
  const q = makeQuestion(over);
  return { ...q, hash: contentHash(q), editedAt: null };
};

describe('contentHash', () => {
  it('normalizes case, punctuation, whitespace and accents', () => {
    expect(normalizeText('  Na+/K+-ATPase,  “Café”!  ')).toBe('na k atpase cafe');
  });

  it('matches a near-duplicate with a different qid, punctuation and option order', () => {
    const a = makeQuestion();
    const b = makeQuestion({
      qid: 'OTHER',
      stem: 'which ION is mostly   reabsorbed in the PCT',
      options: [...a.options].reverse().map((o, i) => ({ ...o, id: 'ABC'[i] })),
    });
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('differs when an option changes', () => {
    const a = makeQuestion();
    const b = makeQuestion({ options: [...a.options.slice(0, 2), { id: 'C', text: 'Potassium', explanation: 'no' }] });
    expect(contentHash(a)).not.toBe(contentHash(b));
  });
});

describe('classifyQuestions', () => {
  it('classifies new, identical, qid conflicts, content duplicates and in-batch repeats', () => {
    const existing = [stored(), stored({ qid: 'OLD-2', stem: 'What does SGLT2 transport?' })];
    const batch = [
      makeQuestion({ qid: 'NEW-1', stem: 'Brand new stem' }),
      makeQuestion(), // identical to existing
      makeQuestion({ qid: 'OLD-2', stem: 'What does SGLT2 transport?', explanation: 'Fixed typo' }), // same qid, edited
      makeQuestion({ qid: 'RENAMED', stem: 'Which ion is MOSTLY reabsorbed in the PCT??' }), // same content, new qid
      makeQuestion({ qid: 'NEW-1', stem: 'Brand new stem' }), // repeats item 0
    ].map((question) => ({ question, fileIndex: 0 }));

    const kinds = classifyQuestions(batch, existing).map((c) => [c.kind, c.existing?.qid, c.dupOf]);
    expect(kinds).toEqual([
      ['new', undefined, undefined],
      ['identical', 'T-W1-D1-L1-Q001', undefined],
      ['qid_conflict', 'OLD-2', undefined],
      ['content_duplicate', 'T-W1-D1-L1-Q001', undefined],
      ['batch_duplicate', undefined, 'NEW-1'],
    ]);
  });

  it('treats a changed correct answer as a conflict, not identical', () => {
    const [c] = classifyQuestions([{ question: makeQuestion({ correct_option: 'B' }), fileIndex: 0 }], [stored()]);
    expect(c.kind).toBe('qid_conflict');
  });
});

describe('helpers', () => {
  it('freeQid finds the next free suffix', () => {
    expect(freeQid('Q1', new Set(['Q1']))).toBe('Q1~2');
    expect(freeQid('Q1', new Set(['Q1', 'Q1~2', 'Q1~3']))).toBe('Q1~4');
  });

  it('sameContent ignores tag-less metadata but sees explanation edits', () => {
    expect(sameContent(makeQuestion(), makeQuestion())).toBe(true);
    expect(sameContent(makeQuestion(), makeQuestion({ key_takeaway: 'changed' }))).toBe(false);
  });

  it('diffQuestion lists only changed fields', () => {
    const d = diffQuestion(makeQuestion(), makeQuestion({ correct_option: 'B', stem: 'New stem' }));
    expect(d.map((x) => x.field)).toEqual(['stem', 'correct answer']);
  });

  it('diffWords marks insertions and deletions', () => {
    const parts = diffWords('the quick fox', 'the slow fox');
    expect(parts.filter((p) => p.type === 'del').map((p) => p.text.trim())).toEqual(['quick']);
    expect(parts.filter((p) => p.type === 'add').map((p) => p.text.trim())).toEqual(['slow']);
  });
});
