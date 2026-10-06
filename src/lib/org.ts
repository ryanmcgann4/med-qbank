import { db as defaultDb, type Folder, type QBankDB, type StoredLecture } from '../db';
import { cyrb53 } from './hash';
import { deleteLectures } from './importer';
import { randomId } from './rng';
import { dayKey, weekKey } from './selection';

/** Auto folders get ids derived from their key, so two devices filing the same day agree. */
export const autoFolderId = (autoKey: string) => `auto-${cyrb53(autoKey)}`;

const byName = (a: Folder, b: Folder) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const byLecture = (a: StoredLecture, b: StoredLecture) => a.date.localeCompare(b.date) || a.lecture_id.localeCompare(b.lecture_id, undefined, { numeric: true });

export interface Tree {
  byId: Map<string, Folder>;
  /** Folder id (null = top level) → its subfolders, sorted. */
  children: Map<string | null, Folder[]>;
  /** Folder id (null = top level) → lectures filed directly in it, sorted. */
  lectures: Map<string | null, StoredLecture[]>;
}

/** Folders whose parent is gone, and lectures whose folder is gone, show at the top level. */
export function buildTree(folders: readonly Folder[], lectures: readonly StoredLecture[]): Tree {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const children = new Map<string | null, Folder[]>();
  const lecs = new Map<string | null, StoredLecture[]>();
  for (const f of folders) {
    const parent = f.parentId && byId.has(f.parentId) && f.parentId !== f.id ? f.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), f]);
  }
  for (const l of lectures) {
    const home = l.folderId && byId.has(l.folderId) ? l.folderId : null;
    lecs.set(home, [...(lecs.get(home) ?? []), l]);
  }
  for (const list of children.values()) list.sort(byName);
  for (const list of lecs.values()) list.sort(byLecture);
  return { byId, children, lectures: lecs };
}

/** The folder and everything inside it (ids). */
export function descendants(tree: Tree, id: string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (fid: string | null) => {
    for (const c of tree.children.get(fid) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c.id);
      walk(c.id);
    }
  };
  if (id) {
    out.push(id);
    seen.add(id);
  }
  walk(id);
  return out;
}

/** Every lecture in this folder or any subfolder (null = the whole library). */
export function lecturesUnder(tree: Tree, id: string | null): StoredLecture[] {
  if (id === null) return [...tree.lectures.values()].flat();
  return descendants(tree, id).flatMap((fid) => tree.lectures.get(fid) ?? []);
}

/** Top-level folder → … → this folder. */
export function pathTo(tree: Tree, id: string | null | undefined): Folder[] {
  const path: Folder[] = [];
  const seen = new Set<string>();
  let cur = id ? tree.byId.get(id) : undefined;
  while (cur && !seen.has(cur.id)) {
    path.unshift(cur);
    seen.add(cur.id);
    cur = cur.parentId ? tree.byId.get(cur.parentId) : undefined;
  }
  return path;
}

/** Your names for the auto-created course/week/day folders, for labels elsewhere in the app. */
export function autoNames(folders: readonly Folder[]) {
  const names = new Map<string, string>();
  for (const f of folders) if (f.autoKey) names.set(f.autoKey, f.name);
  return {
    course: (course: string) => names.get(`course:${course}`) ?? course,
    week: (course: string, week: number) => names.get(`week:${weekKey(course, week)}`) ?? `Week ${week}`,
    day: (course: string, label: string) => names.get(`day:${dayKey(course, label)}`) ?? label,
  };
}

/**
 * File every lecture that has never been filed under Course › Week › Day,
 * creating those folders if needed. Existing folders are reused even if you
 * renamed or moved them. Untouched auto folders and placements are stamped 0,
 * so anything you change on any device wins when devices sync.
 */
export async function ensureOrganization(database: QBankDB = defaultDb): Promise<number> {
  return database.transaction('rw', [database.lectures, database.folders, database.deletions], async () => {
    const unfiled = (await database.lectures.toArray()).filter((l) => l.folderId === undefined);
    if (!unfiled.length) return 0;
    const known = new Set((await database.folders.toCollection().primaryKeys()) as string[]);
    const ensure = async (autoKey: string, name: string, parentId: string | null) => {
      const id = autoFolderId(autoKey);
      if (!known.has(id)) {
        // If you deleted this folder before, recreate it newer than the delete so it sticks.
        const deleted = await database.deletions.get(`folder:${id}`);
        await database.folders.put({ id, name, parentId, autoKey, updatedAt: deleted ? Date.now() : 0 });
        known.add(id);
      }
      return id;
    };
    for (const l of unfiled) {
      const course = await ensure(`course:${l.course}`, l.course, null);
      const week = await ensure(`week:${weekKey(l.course, l.week)}`, `Week ${l.week}`, course);
      const day = await ensure(`day:${dayKey(l.course, l.day_label)}`, l.day_label, week);
      await database.lectures.update(l.lecture_id, { folderId: day });
    }
    return unfiled.length;
  });
}

export async function createFolder(name: string, parentId: string | null, database: QBankDB = defaultDb): Promise<Folder> {
  const f: Folder = { id: randomId(), name: name.trim() || 'New folder', parentId, updatedAt: Date.now() };
  await database.folders.put(f);
  return f;
}

export async function renameFolder(id: string, name: string, database: QBankDB = defaultDb): Promise<void> {
  if (name.trim()) await database.folders.update(id, { name: name.trim(), updatedAt: Date.now() });
}

export async function moveFolder(id: string, parentId: string | null, database: QBankDB = defaultDb): Promise<void> {
  await database.transaction('rw', [database.folders, database.lectures], async () => {
    const tree = buildTree(await database.folders.toArray(), []);
    if (parentId && descendants(tree, id).includes(parentId)) throw new Error("A folder can't go inside itself.");
    await database.folders.update(id, { parentId, updatedAt: Date.now() });
  });
}

/**
 * Delete a folder. By default its lectures and subfolders move up one level;
 * with `withQuestions`, everything inside is deleted too (lectures, questions,
 * and your history for them).
 */
export async function deleteFolder(id: string, { withQuestions = false } = {}, database: QBankDB = defaultDb): Promise<void> {
  const tables = [database.folders, database.lectures, database.deletions, database.questions, database.progress, database.attempts];
  await database.transaction('rw', tables, async () => {
    const folder = await database.folders.get(id);
    if (!folder) return;
    const tree = buildTree(await database.folders.toArray(), await database.lectures.toArray());
    const now = Date.now();
    const tombstone = (fid: string) => database.deletions.put({ id: `folder:${fid}`, kind: 'folder', key: fid, at: now });
    if (withQuestions) {
      const gone = descendants(tree, id);
      await deleteLectures(lecturesUnder(tree, id).map((l) => l.lecture_id), database);
      await database.folders.bulkDelete(gone);
      for (const fid of gone) await tombstone(fid);
      return;
    }
    const up = tree.byId.has(folder.parentId ?? '') ? folder.parentId : null;
    for (const c of tree.children.get(id) ?? []) await database.folders.update(c.id, { parentId: up, updatedAt: now });
    for (const l of tree.lectures.get(id) ?? []) await database.lectures.update(l.lecture_id, { folderId: up, movedAt: now });
    await database.folders.delete(id);
    await tombstone(id);
  });
}

export async function moveLectures(lectureIds: readonly string[], folderId: string | null, database: QBankDB = defaultDb): Promise<void> {
  const now = Date.now();
  await database.transaction('rw', database.lectures, async () => {
    for (const id of lectureIds) await database.lectures.update(id, { folderId, movedAt: now });
  });
}

/** Rename a lecture; `null` goes back to the title from the import file. */
export async function renameLecture(id: string, title: string | null, database: QBankDB = defaultDb): Promise<void> {
  await database.transaction('rw', database.lectures, async () => {
    const l = await database.lectures.get(id);
    if (!l) return;
    const imported = l.importedTitle ?? l.title;
    const next = title?.trim() || imported;
    await database.lectures.update(id, { title: next, importedTitle: imported, renamedAt: Date.now() });
  });
}
