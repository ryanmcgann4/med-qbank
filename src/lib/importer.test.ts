import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QBankDB } from '../db';
import { sample, sampleText } from '../test/fixtures';
import { applyImport, planImport } from './importer';
import { recordAttempts } from './tracking';

let db: QBankDB;
let n = 0;

beforeEach(async () => {
  db = new QBankDB(`test-${n++}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

const src = (text: string, name = 'B2_W6_D1.json') => [{ name, text }];

describe('import', () => {
  it('imports a day file: questions, lectures and an import record', async () => {
    const plan = await planImport(src(sampleText()), db);
    expect(plan.items.every((i) => i.kind === 'new')).toBe(true);
    const out = await applyImport(plan, {}, db);
    expect(out.added).toBe(10);
    expect(await db.questions.count()).toBe(10);
    expect((await db.lectures.get('B2-W6-D1-L1'))?.day_label).toBe('Week 6 – Day 1 (Mon Oct 5)');
    expect((await db.imports.toArray())[0].files[0].day_label).toBe('Week 6 – Day 1 (Mon Oct 5)');
  });

  it('re-importing the same file is a no-op', async () => {
    await applyImport(await planImport(src(sampleText()), db), {}, db);
    const plan = await planImport(src(sampleText()), db);
    expect(plan.items.every((i) => i.kind === 'identical')).toBe(true);
    const out = await applyImport(plan, {}, db);
    expect(out).toMatchObject({ added: 0, skipped: 10 });
    expect(await db.questions.count()).toBe(10);
  });

  it('never wipes progress: overwrite keeps history, keep-both adds a ~2 copy, skip changes nothing', async () => {
    await applyImport(await planImport(src(sampleText()), db), {}, db);
    const qid = 'B2-W6-D1-L1-Q001';
    await recordAttempts([{ qid, ts: Date.now(), chosen: 'B', correct: false, confidence: 'sure', timeMs: 5000, mode: 'smart', sessionId: 's' }], db);
    await db.progress.update(qid, { flagged: true, note: 'check slide 9' });

    const fixed = sample();
    fixed.questions[0].explanation = 'Corrected explanation.';
    fixed.questions[1].explanation = 'Another fix.';
    fixed.questions[2].explanation = 'Third fix.';
    const plan = await planImport(src(JSON.stringify(fixed)), db);
    const conflicts = plan.items.filter((i) => i.kind === 'qid_conflict');
    expect(conflicts.map((c) => c.question.qid)).toEqual([qid, 'B2-W6-D1-L1-Q002', 'B2-W6-D1-L1-Q003']);
    expect(conflicts.every((c) => c.resolution === 'skip')).toBe(true); // safe default

    const out = await applyImport(plan, { [conflicts[0].key]: 'overwrite', [conflicts[1].key]: 'keep_both' }, db);
    expect(out).toMatchObject({ overwritten: 1, keptBoth: 1, added: 0 });

    expect((await db.questions.get(qid))?.explanation).toBe('Corrected explanation.');
    const progress = await db.progress.get(qid);
    expect(progress).toMatchObject({ timesSeen: 1, lastResult: 'wrong', flagged: true, note: 'check slide 9' });
    expect(await db.attempts.where('qid').equals(qid).count()).toBe(1);

    expect((await db.questions.get('B2-W6-D1-L1-Q002~2'))?.explanation).toBe('Another fix.');
    expect((await db.questions.get('B2-W6-D1-L1-Q002'))?.explanation).not.toBe('Another fix.');
    expect((await db.questions.get('B2-W6-D1-L1-Q003'))?.explanation).not.toBe('Third fix.');
  });

  it('catches the same question under a new qid', async () => {
    await applyImport(await planImport(src(sampleText()), db), {}, db);
    const renamed = sample();
    renamed.questions = [{ ...renamed.questions[0], qid: 'B2-W6-D1-L1-Q099', stem: renamed.questions[0].stem.toUpperCase() }];
    const plan = await planImport(src(JSON.stringify(renamed)), db);
    expect(plan.items[0]).toMatchObject({ kind: 'content_duplicate', existing: { qid: 'B2-W6-D1-L1-Q001' } });
  });

  it('imports the good questions from a partly broken file and counts the bad ones', async () => {
    const f = sample();
    (f.questions[0] as unknown as Record<string, unknown>).stem = '';
    const plan = await planImport(src(JSON.stringify(f)), db);
    const out = await applyImport(plan, {}, db);
    expect(out).toMatchObject({ added: 9, invalid: 1 });
  });

  it('flags repeats across files in the same batch', async () => {
    const plan = await planImport([...src(sampleText(), 'a.json'), ...src(sampleText(), 'b.json')], db);
    expect(plan.items.filter((i) => i.kind === 'batch_duplicate')).toHaveLength(10);
    expect((await applyImport(plan, {}, db)).added).toBe(10);
  });
});
