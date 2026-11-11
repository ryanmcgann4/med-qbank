import { describe, expect, it } from 'vitest';
import { importDay } from '../../connector/src/importDay';
import { sampleText } from '../test/fixtures';
import type { BackupData } from './merge';
import { autoChain } from './org';

const empty = (): BackupData => ({ questions: [], lectures: [], progress: [], attempts: [], sessions: [], imports: [], kv: [], folders: [], deletions: [] });
const DAY = { course: 'Block 2', week: 6, day_label: 'Week 6 – Day 1 (Mon Oct 5)' };

describe('importDay filing (Make Q-Bank Questions)', () => {
  it('files new lectures under Course › Week › Day by default', () => {
    const { change } = importDay(empty(), sampleText(), 'day.json', 1);
    const dayId = autoChain(DAY).at(-1)!.id;
    expect(change!.data.lectures.every((l) => l.folderId === dayId)).toBe(true);
  });

  it('puts lectures in the folder you picked, inside a new subfolder, and reuses that subfolder next time', () => {
    const data = empty();
    data.folders!.push({ id: 'review', name: 'Exam 2 review', parentId: null, updatedAt: 5 });
    const first = importDay(data, sampleText(), 'day.json', 10, { folderId: 'review', newFolder: 'Renal' }).change!.data;
    const sub = first.folders!.find((f) => f.name === 'Renal')!;
    expect(sub.parentId).toBe('review');
    expect(first.lectures.every((l) => l.folderId === sub.id && l.movedAt === 10)).toBe(true);
    const again = importDay(first, sampleText(), 'day.json', 20, { folderId: 'review', newFolder: 'renal' }).change!.data;
    expect(again.folders!.filter((f) => f.name === 'Renal')).toHaveLength(1);
    expect(again.lectures.every((l) => l.folderId === sub.id && l.movedAt === 10)).toBe(true);
  });

  it('creates the day folder when you pick it before it exists, and handles the top level', () => {
    const dayId = autoChain(DAY).at(-1)!.id;
    const d = importDay(empty(), sampleText(), 'day.json', 1, { folderId: dayId }).change!.data;
    expect(d.folders!.map((f) => f.id)).toContain(dayId);
    const top = importDay(empty(), sampleText(), 'day.json', 1, { folderId: null }).change!.data;
    expect(top.lectures.every((l) => l.folderId === null)).toBe(true);
  });

  it('falls back to the day folder if the picked one is gone', () => {
    const r = importDay(empty(), sampleText(), 'day.json', 1, { folderId: 'deleted-folder' });
    expect(r.change!.data.lectures.every((l) => l.folderId === autoChain(DAY).at(-1)!.id)).toBe(true);
    expect(String(r.report.warnings)).toContain("isn't in the Library");
  });
});
