import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importDay } from '../../connector/src/importDay';
import { QBankDB } from '../db';
import { sample, sampleText } from '../test/fixtures';
import { mergeInto, readAll } from './backup';
import type { BackupData } from './merge';
import { applyImport, planImport } from './importer';
import {
  autoFolderId,
  autoNames,
  buildTree,
  createFolder,
  deleteFolder,
  ensureOrganization,
  lecturesUnder,
  moveFolder,
  moveLectures,
  pathTo,
  renameFolder,
  renameLecture,
} from './org';

let n = 0;
let db: QBankDB;
const open = async () => {
  const d = new QBankDB(`org-test-${n++}`);
  await d.open();
  return d;
};
beforeEach(async () => {
  db = await open();
});
afterEach(async () => {
  await db.delete();
});

const importSample = (d: QBankDB, text = sampleText()) => planImport([{ name: 's', text }], d).then((p) => applyImport(p, {}, d));
const L1 = 'B2-W6-D1-L1';
const L2 = 'B2-W6-D1-L2';
const DAY = autoFolderId('day:Block 2::Week 6 – Day 1 (Mon Oct 5)');
const WEEK = autoFolderId('week:Block 2::6');
const COURSE = autoFolderId('course:Block 2');
const tree = async (d = db) => buildTree(await d.folders.toArray(), await d.lectures.toArray());

describe('imports from Claude or the Finder action', () => {
  const blank = () => ({ questions: [], lectures: [], progress: [], attempts: [], sessions: [], imports: [], kv: [] }) as BackupData;

  it('files new lectures under Course › Week › Day in the data it saves', () => {
    const data = blank();
    importDay(data, sampleText(), 's.json', 1000);
    expect(data.lectures.map((l) => l.folderId)).toEqual([DAY, DAY]);
    const t = buildTree(data.folders ?? [], data.lectures);
    expect(pathTo(t, DAY).map((f) => f.name)).toEqual(['Block 2', 'Week 6', 'Week 6 – Day 1 (Mon Oct 5)']);
    expect(data.folders?.every((f) => f.updatedAt === 0)).toBe(true);
  });

  it('reuses folders, including ones you renamed', () => {
    const data = blank();
    data.folders = [{ id: DAY, name: 'Monday', parentId: WEEK, autoKey: 'x', updatedAt: 5 }];
    importDay(data, sampleText(), 's.json', 1000);
    expect(data.folders.find((f) => f.id === DAY)?.name).toBe('Monday');
    expect(data.folders.filter((f) => f.id === DAY)).toHaveLength(1);
  });

  it('keeps a lecture where you moved it, even at the top level, and files one never filed', () => {
    const data = blank();
    importDay(data, sampleText(), 's.json', 1000);
    data.lectures.find((l) => l.lecture_id === L1)!.folderId = null;
    delete data.lectures.find((l) => l.lecture_id === L2)!.folderId;
    importDay(data, sampleText(), 's.json', 2000);
    expect(data.lectures.find((l) => l.lecture_id === L1)?.folderId).toBeNull();
    expect(data.lectures.find((l) => l.lecture_id === L2)?.folderId).toBe(DAY);
  });

  it('files a lecture the same as the app, so devices agree', async () => {
    const data = blank();
    importDay(data, sampleText(), 's.json', 1000);
    await importSample(db);
    expect((await db.lectures.get(L1))?.folderId).toBe(data.lectures.find((l) => l.lecture_id === L1)?.folderId);
    expect((await db.folders.toArray()).map((f) => f.id).sort()).toEqual((data.folders ?? []).map((f) => f.id).sort());
  });
});

describe('auto-filing', () => {
  it('files imported lectures under Course › Week › Day', async () => {
    await importSample(db);
    const t = await tree();
    expect(pathTo(t, DAY).map((f) => f.name)).toEqual(['Block 2', 'Week 6', 'Week 6 – Day 1 (Mon Oct 5)']);
    expect(t.lectures.get(DAY)?.map((l) => l.lecture_id)).toEqual([L1, L2]);
    expect(lecturesUnder(t, COURSE)).toHaveLength(2);
    expect(await ensureOrganization(db)).toBe(0); // nothing left to file
  });

  it('re-importing keeps your folder names, lecture names, and placement', async () => {
    await importSample(db);
    await renameFolder(DAY, 'Mon: renal intro', db);
    await renameFolder(COURSE, 'Block 2: Renal', db);
    await renameLecture(L1, 'PCT transport', db);
    const mine = await createFolder('Hard ones', null, db);
    await moveLectures([L2], mine.id, db);

    const f = sample();
    f.lectures[0].summary = 'Updated summary.';
    await importSample(db, JSON.stringify(f));

    const t = await tree();
    expect(t.byId.get(DAY)?.name).toBe('Mon: renal intro');
    expect(await db.folders.count()).toBe(4); // no duplicate auto folders
    const l1 = await db.lectures.get(L1);
    expect(l1).toMatchObject({ title: 'PCT transport', summary: 'Updated summary.', importedTitle: 'Renal Tubular Physiology I', folderId: DAY });
    expect((await db.lectures.get(L2))?.folderId).toBe(mine.id);
    const names = autoNames(await db.folders.toArray());
    expect(names.course('Block 2')).toBe('Block 2: Renal');
    expect(names.week('Block 2', 6)).toBe('Week 6');

    await renameLecture(L1, null, db);
    expect((await db.lectures.get(L1))?.title).toBe('Renal Tubular Physiology I');
  });
});

describe('folders', () => {
  it('subfolders, moves, and no folder inside itself', async () => {
    await importSample(db);
    const exam = await createFolder('Exam prep', null, db);
    const sub = await createFolder('Renal', exam.id, db);
    await moveFolder(WEEK, sub.id, db);
    const t = await tree();
    expect(pathTo(t, DAY).map((f) => f.name)).toEqual(['Exam prep', 'Renal', 'Week 6', 'Week 6 – Day 1 (Mon Oct 5)']);
    expect(lecturesUnder(t, exam.id)).toHaveLength(2);
    await expect(moveFolder(exam.id, sub.id, db)).rejects.toThrow(/inside itself/);
  });

  it('deleting a folder moves its contents up a level by default', async () => {
    await importSample(db);
    await deleteFolder(WEEK, {}, db);
    const t = await tree();
    expect(t.byId.has(WEEK)).toBe(false);
    expect(t.byId.get(DAY)?.parentId).toBe(COURSE);
    expect(await db.questions.count()).toBe(10);
  });

  it('can delete a folder together with its questions', async () => {
    await importSample(db);
    await deleteFolder(COURSE, { withQuestions: true }, db);
    expect(await db.folders.count()).toBe(0);
    expect(await db.lectures.count()).toBe(0);
    expect(await db.questions.count()).toBe(0);
  });

  it('a deleted auto folder comes back for a new import and survives syncing', async () => {
    await importSample(db);
    await deleteFolder(DAY, { withQuestions: true }, db);
    await importSample(db);
    const merged = await mergeInto(await readAll(db), db);
    expect(merged.folders?.map((f) => f.id)).toContain(DAY);
    expect((await db.lectures.get(L1))?.folderId).toBe(DAY);
  });
});

describe('two devices', () => {
  it("one renames while the other moves: both changes survive, and untouched auto folders don't clobber them", async () => {
    const phone = await open();
    await importSample(db);
    await importSample(phone);

    await renameLecture(L1, 'PCT transport', phone);
    await renameFolder(WEEK, 'Renal week 1', phone);
    const hard = await createFolder('Hard ones', null, db);
    await moveLectures([L1], hard.id, db);

    await mergeInto(await readAll(phone), db);
    await mergeInto(await readAll(db), phone);
    for (const d of [db, phone]) {
      expect(await d.lectures.get(L1)).toMatchObject({ title: 'PCT transport', folderId: hard.id });
      expect((await d.folders.get(WEEK))?.name).toBe('Renal week 1');
    }

    await moveLectures([L1], null, phone); // top level
    await mergeInto(await readAll(phone), db);
    expect((await db.lectures.get(L1))?.folderId).toBeNull();
    await phone.delete();
  });
});
