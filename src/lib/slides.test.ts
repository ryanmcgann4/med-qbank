import { describe, expect, it } from 'vitest';
import { makeQuestion } from '../test/fixtures';
import { contentHash } from './hash';
import { slideLink } from './slides';

describe('open slides link', () => {
  it('carries what the Mac helper needs to find the file and slide', () => {
    const q = makeQuestion({ qid: 'Q1', lecture_id: 'B2-W7-D1-L1' });
    const stored = { ...q, source: { ...q.source, slides: 'handout p1' }, hash: contentHash(q), importedAt: 0, updatedAt: 0, editedAt: null };
    const lecture = { lecture_id: 'B2-W7-D1-L1', title: 'Bacteria', lecturer: '', summary: '', learning_objectives: [], course: 'Block 2', week: 7, day_label: 'Mon', date: '2026-09-14', importedAt: 0 };
    const url = new URL(slideLink(stored, lecture));
    expect(url.protocol).toBe('qbank-slides:');
    expect(Object.fromEntries(url.searchParams)).toEqual({ lecture: 'B2-W7-D1-L1', src: 'handout p1', course: 'Block 2', title: 'Bacteria', week: '7', date: '2026-09-14' });
  });
});
