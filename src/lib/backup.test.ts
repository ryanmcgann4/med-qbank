import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QBankDB, type Attempt } from '../db';
import { sampleText } from '../test/fixtures';
import { exportBackup, mergeData, parseBackup, readAll, restoreBackup } from './backup';
import { applyImport, planImport } from './importer';
import { recordAttempts, updateProgress } from './tracking';

let n = 0;
const fresh = async () => {
  const d = new QBankDB(`backup-test-${n++}`);
  await d.open();
  return d;
};
let a: QBankDB;
let b: QBankDB;
beforeEach(async () => {
  a = await fresh();
  b = await fresh();
});
afterEach(async () => {
  await a.delete();
  await b.delete();
});

const Q1 = 'B2-W6-D1-L1-Q001';
const Q2 = 'B2-W6-D1-L1-Q002';
const T0 = new Date(2026, 9, 5, 9).getTime();
const att = (qid: string, ts: number, correct: boolean, sessionId = 's'): Omit<Attempt, 'id'> => ({
  qid,
  ts,
  chosen: correct ? 'A' : 'B',
  correct,
  confidence: 'sure',
  timeMs: 1000,
  mode: 'smart',
  sessionId,
});

async function seed(d: QBankDB) {
  await applyImport(await planImport([{ name: 's.json', text: sampleText() }], d), {}, d);
}

describe('backup', () => {
  it('round-trips through JSON and replace-restore', async () => {
    await seed(a);
    await recordAttempts([att(Q1, T0, false)], a);
    await updateProgress(Q1, { note: 'slide 9', flagged: true }, a);

    const file = await exportBackup(a);
    const parsed = parseBackup(JSON.stringify(file));
    expect(parsed.error).toBeUndefined();
    await restoreBackup(parsed.data!, 'replace', b);

    const restored = await readAll(b);
    expect(restored.questions).toHaveLength(10);
    expect(restored.attempts).toHaveLength(1);
    expect(await b.progress.get(Q1)).toMatchObject({ timesSeen: 1, lastResult: 'wrong', note: 'slide 9', flagged: true });
  });

  it('rejects files that are not backups, with a helpful message', () => {
    expect(parseBackup('{oops').error).toMatch(/Not valid JSON/);
    expect(parseBackup(sampleText()).error).toMatch(/question file/);
    expect(parseBackup('{"app":"other"}').error).toMatch(/doesn't look like a Q-Bank backup/);
  });

  it('merge unions answer history from two devices and rebuilds progress', async () => {
    await seed(a);
    await seed(b);
    // Laptop: missed Q1 on day 1. Phone: got Q1 right on day 2, and Q2 right.
    await recordAttempts([att(Q1, T0, false, 'laptop')], a);
    await updateProgress(Q1, { note: 'laptop note' }, a);
    await recordAttempts([att(Q1, T0 + 86_400_000, true, 'phone'), att(Q2, T0, true, 'phone')], b);
    await updateProgress(Q1, { flagged: true, note: 'phone note' }, b);
    await b.progress.update(Q1, { metaUpdatedAt: Date.now() + 1000 }); // definitely the newer edit

    await restoreBackup(await exportBackup(b), 'merge', a);

    expect(await a.attempts.count()).toBe(3);
    const p1 = await a.progress.get(Q1);
    // The phone's flag + note were set after the laptop's note, so they win.
    expect(p1).toMatchObject({ timesSeen: 2, timesCorrect: 1, lastResult: 'correct', flagged: true, note: 'phone note' });
    expect(await a.progress.get(Q2)).toMatchObject({ timesSeen: 1, timesCorrect: 1 });
    expect(await a.questions.count()).toBe(10);

    // Merging the same backup again changes nothing.
    await restoreBackup(await exportBackup(b), 'merge', a);
    expect(await a.attempts.count()).toBe(3);
  });

  it('merge keeps the newer edit of a question', async () => {
    await seed(a);
    const data = await readAll(a);
    const newer = { ...data.questions[0], explanation: 'edited later', updatedAt: data.questions[0].updatedAt + 1000 };
    const merged = mergeData(data, { ...data, questions: [newer], attempts: [], progress: [] });
    expect(merged.questions.find((q) => q.qid === newer.qid)?.explanation).toBe('edited later');
    expect(merged.questions).toHaveLength(10);
  });
});
