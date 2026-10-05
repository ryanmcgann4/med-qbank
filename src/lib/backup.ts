import { z } from 'zod';
import {
  db as defaultDb,
  emptyProgress,
  type Attempt,
  type Deletion,
  type ImportRecord,
  type KV,
  type Progress,
  type QBankDB,
  type QuizSession,
  type StoredLecture,
  type StoredQuestion,
} from '../db';
import { todayISO } from './dates';
import { downloadText } from './download';
import { applyAttempt } from './tracking';

export const BACKUP_VERSION = 1;

export interface BackupData {
  questions: StoredQuestion[];
  lectures: StoredLecture[];
  progress: Progress[];
  attempts: Attempt[];
  sessions: QuizSession[];
  imports: ImportRecord[];
  kv: KV[];
  /** Tombstones (absent in backups made before sync existed). */
  deletions?: Deletion[];
}

export interface BackupFile extends BackupData {
  app: 'med-qbank';
  backup_version: number;
  exported_at: string;
}

// Shallow check: enough to reject the wrong kind of file without re-validating every row.
const BackupShape = z.object({
  app: z.literal('med-qbank'),
  backup_version: z.number().int().min(1).max(BACKUP_VERSION),
  exported_at: z.string(),
  questions: z.array(z.object({ qid: z.string(), stem: z.string(), options: z.array(z.unknown()) }).loose()),
  lectures: z.array(z.object({ lecture_id: z.string() }).loose()),
  progress: z.array(z.object({ qid: z.string() }).loose()),
  attempts: z.array(z.object({ qid: z.string(), ts: z.number() }).loose()),
  sessions: z.array(z.object({ id: z.string() }).loose()).default([]),
  imports: z.array(z.object({ importedAt: z.number() }).loose()).default([]),
  kv: z.array(z.object({ key: z.string() }).loose()).default([]),
  deletions: z.array(z.object({ id: z.string(), at: z.number() }).loose()).default([]),
});

/** Device-local keys (sync bookkeeping) never leave this browser in a backup. */
const isDeviceKey = (key: string) => key.startsWith('sync');

export const backupFileName = (now = Date.now()) => `qbank-backup-${todayISO(now)}.json`;

export async function readAll(database: QBankDB = defaultDb): Promise<BackupData> {
  const [questions, lectures, progress, attempts, sessions, imports, kv, deletions] = await Promise.all([
    database.questions.toArray(),
    database.lectures.toArray(),
    database.progress.toArray(),
    database.attempts.toArray(),
    database.sessions.toArray(),
    database.imports.toArray(),
    database.kv.toArray(),
    database.deletions.toArray(),
  ]);
  return { questions, lectures, progress, attempts, sessions, imports, kv, deletions };
}

export async function exportBackup(database: QBankDB = defaultDb, now = Date.now()): Promise<BackupFile> {
  const data = await readAll(database);
  return {
    app: 'med-qbank',
    backup_version: BACKUP_VERSION,
    exported_at: new Date(now).toISOString(),
    ...data,
    kv: data.kv.filter((k) => !isDeviceKey(k.key)),
  };
}

export function parseBackup(text: string): { data?: BackupFile; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { error: `Not valid JSON: ${(e as Error).message}` };
  }
  if (raw && typeof raw === 'object' && 'questions' in raw && 'day_label' in raw) {
    return { error: 'This is a question file, not a backup. Import it on the Add page instead.' };
  }
  const r = BackupShape.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    return { error: `This doesn't look like a Q-Bank backup (${i.path.join('.') || 'file'}: ${i.message}).` };
  }
  return { data: r.data as unknown as BackupFile };
}

const attemptKey = (a: Attempt) => `${a.qid}|${a.ts}|${a.sessionId}|${a.chosen}`;

type Meta = Pick<Progress, 'flagged' | 'note' | 'report' | 'metaUpdatedAt'>;
const metaOf = (p: Progress): Meta => ({ flagged: p.flagged, note: p.note, report: p.report, metaUpdatedAt: p.metaUpdatedAt });

/** Newest flag/note/report wins. Without timestamps (old backups), keep whatever is set. */
function mergeMeta(a: Meta, b: Meta): Meta {
  const ta = a.metaUpdatedAt ?? 0;
  const tb = b.metaUpdatedAt ?? 0;
  if (ta !== tb) return ta > tb ? a : b;
  return { flagged: a.flagged || b.flagged, note: a.note || b.note, report: a.report ?? b.report, metaUpdatedAt: ta || undefined };
}

/**
 * Combine two copies of the bank (e.g. phone + laptop). Answer histories are
 * unioned and every question's progress is rebuilt by replaying the merged
 * history, so nothing answered on either device is lost. Edits and
 * flags/notes resolve newest-first, and deletions (tombstones) stick.
 */
export function mergeData(current: BackupData, incoming: BackupData): BackupData {
  const deletions = new Map<string, Deletion>();
  for (const d of [...(current.deletions ?? []), ...(incoming.deletions ?? [])]) {
    const prev = deletions.get(d.id);
    if (!prev || d.at > prev.at) deletions.set(d.id, d);
  }
  const deletedAt = (kind: Deletion['kind'], key: string) => deletions.get(`${kind}:${key}`)?.at ?? -Infinity;

  const questions = new Map(current.questions.map((q) => [q.qid, q]));
  for (const q of incoming.questions) {
    const mine = questions.get(q.qid);
    if (!mine || q.updatedAt > mine.updatedAt) questions.set(q.qid, q);
  }
  // A re-import after a delete is newer than the tombstone and survives.
  for (const [qid, q] of questions) if (deletedAt('question', qid) >= q.updatedAt) questions.delete(qid);

  const lectures = new Map(current.lectures.map((l) => [l.lecture_id, l]));
  for (const l of incoming.lectures) {
    const mine = lectures.get(l.lecture_id);
    if (!mine || l.importedAt > mine.importedAt) lectures.set(l.lecture_id, l);
  }
  for (const [id, l] of lectures) if (deletedAt('lecture', id) >= l.importedAt) lectures.delete(id);

  const attempts = new Map<string, Attempt>();
  for (const a of [...current.attempts, ...incoming.attempts]) {
    if (deletedAt('question', a.qid) >= a.ts) continue;
    const { id: _id, ...rest } = a;
    void _id;
    attempts.set(attemptKey(a), rest);
  }
  const mergedAttempts = [...attempts.values()].sort((a, b) => a.ts - b.ts);

  const meta = new Map<string, Meta>();
  for (const p of [...current.progress, ...incoming.progress]) {
    if (deletedAt('question', p.qid) >= (p.metaUpdatedAt ?? p.lastAnsweredAt ?? 0)) continue;
    const prev = meta.get(p.qid);
    meta.set(p.qid, prev ? mergeMeta(prev, metaOf(p)) : metaOf(p));
  }

  const byQid = new Map<string, Attempt[]>();
  for (const a of mergedAttempts) {
    const list = byQid.get(a.qid) ?? [];
    list.push(a);
    byQid.set(a.qid, list);
  }

  const progress: Progress[] = [];
  for (const qid of new Set([...meta.keys(), ...byQid.keys()])) {
    const base: Progress = { ...emptyProgress(qid), ...meta.get(qid) };
    const history = byQid.get(qid) ?? [];
    progress.push(history.reduce<Progress>((p, a) => ({ ...applyAttempt(p, qid, a), ...metaOf(p) }), base));
  }

  const sessions = new Map(current.sessions.map((s) => [s.id, s]));
  for (const s of incoming.sessions) {
    const mine = sessions.get(s.id);
    if (!mine || (!mine.finishedAt && (s.finishedAt || s.elapsedMs > mine.elapsedMs))) sessions.set(s.id, s);
  }

  const importKey = (i: ImportRecord) => `${i.importedAt}|${i.files.map((f) => f.name).join(',')}`;
  const imports = new Map<string, ImportRecord>();
  for (const i of [...current.imports, ...incoming.imports]) {
    const { id: _id, ...rest } = i;
    void _id;
    if (!imports.has(importKey(i))) imports.set(importKey(i), rest);
  }

  const kv = new Map(incoming.kv.filter((k) => !isDeviceKey(k.key)).map((k) => [k.key, k]));
  for (const k of current.kv) kv.set(k.key, k);

  return {
    questions: [...questions.values()],
    lectures: [...lectures.values()],
    progress,
    attempts: mergedAttempts,
    sessions: [...sessions.values()],
    imports: [...imports.values()].sort((a, b) => a.importedAt - b.importedAt),
    kv: [...kv.values()],
    deletions: [...deletions.values()],
  };
}

const allTables = (d: QBankDB) => [d.questions, d.lectures, d.progress, d.attempts, d.sessions, d.imports, d.kv, d.deletions];

async function replaceAll(data: BackupData, database: QBankDB) {
  await database.transaction('rw', allTables(database), async () => {
    await Promise.all(allTables(database).map((t) => t.clear()));
    await database.questions.bulkAdd(data.questions);
    await database.lectures.bulkAdd(data.lectures);
    await database.progress.bulkAdd(data.progress);
    await database.attempts.bulkAdd(data.attempts);
    await database.sessions.bulkAdd(data.sessions);
    await database.imports.bulkAdd(data.imports);
    await database.kv.bulkAdd(data.kv);
    await database.deletions.bulkAdd(data.deletions ?? []);
  });
}

/**
 * Merge `incoming` into the database atomically: the read, merge and write
 * happen in one transaction, so an answer recorded meanwhile can't be lost.
 */
export async function mergeInto(incoming: BackupData, database: QBankDB = defaultDb): Promise<BackupData> {
  return database.transaction('rw', allTables(database), async () => {
    const merged = mergeData(await readAll(database), incoming);
    await replaceAll(merged, database);
    return merged;
  });
}

export async function restoreBackup(file: BackupData, mode: 'replace' | 'merge', database: QBankDB = defaultDb): Promise<BackupData> {
  if (mode === 'merge') return mergeInto(file, database);
  const data = { ...file, kv: file.kv.filter((k) => !isDeviceKey(k.key)) };
  await replaceAll(data, database);
  return data;
}

export const LAST_BACKUP_KEY = 'lastBackupAt';
export const BACKUP_SNOOZE_KEY = 'backupBannerDismissedAt';

/** Export everything and save it as a file; remembers when, for the weekly reminder. */
export async function downloadBackup(database: QBankDB = defaultDb): Promise<BackupFile> {
  const file = await exportBackup(database);
  downloadText(JSON.stringify(file), backupFileName());
  await database.kv.put({ key: LAST_BACKUP_KEY, value: Date.now() });
  return file;
}
