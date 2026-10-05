import { z } from 'zod';
import {
  db as defaultDb,
  emptyProgress,
  type Attempt,
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
});

export const backupFileName = (now = Date.now()) => `qbank-backup-${todayISO(now)}.json`;

export async function readAll(database: QBankDB = defaultDb): Promise<BackupData> {
  const [questions, lectures, progress, attempts, sessions, imports, kv] = await Promise.all([
    database.questions.toArray(),
    database.lectures.toArray(),
    database.progress.toArray(),
    database.attempts.toArray(),
    database.sessions.toArray(),
    database.imports.toArray(),
    database.kv.toArray(),
  ]);
  return { questions, lectures, progress, attempts, sessions, imports, kv };
}

export async function exportBackup(database: QBankDB = defaultDb, now = Date.now()): Promise<BackupFile> {
  return { app: 'med-qbank', backup_version: BACKUP_VERSION, exported_at: new Date(now).toISOString(), ...(await readAll(database)) };
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

/**
 * Combine two copies of the bank (e.g. phone + laptop). Answer histories are
 * unioned and every question's progress is rebuilt by replaying the merged
 * history, so nothing answered on either device is lost.
 */
export function mergeData(current: BackupData, incoming: BackupData): BackupData {
  const questions = new Map(current.questions.map((q) => [q.qid, q]));
  for (const q of incoming.questions) {
    const mine = questions.get(q.qid);
    if (!mine || q.updatedAt > mine.updatedAt) questions.set(q.qid, q);
  }

  const lectures = new Map(current.lectures.map((l) => [l.lecture_id, l]));
  for (const l of incoming.lectures) if (!lectures.has(l.lecture_id)) lectures.set(l.lecture_id, l);

  const attempts = new Map<string, Attempt>();
  for (const a of [...current.attempts, ...incoming.attempts]) {
    const { id: _id, ...rest } = a;
    void _id;
    attempts.set(attemptKey(a), rest);
  }
  const mergedAttempts = [...attempts.values()].sort((a, b) => a.ts - b.ts);

  // Per-question notes/flags/reports from both sides.
  const meta = new Map<string, Progress>();
  for (const p of [...current.progress, ...incoming.progress]) {
    const prev = meta.get(p.qid);
    if (!prev) {
      meta.set(p.qid, p);
      continue;
    }
    const note = prev.note && p.note && prev.note !== p.note ? `${prev.note}\n---\n${p.note}` : prev.note || p.note;
    meta.set(p.qid, { ...prev, flagged: prev.flagged || p.flagged, note, report: prev.report ?? p.report });
  }

  const byQid = new Map<string, Attempt[]>();
  for (const a of mergedAttempts) {
    const list = byQid.get(a.qid) ?? [];
    list.push(a);
    byQid.set(a.qid, list);
  }

  const progress: Progress[] = [];
  for (const qid of new Set([...meta.keys(), ...byQid.keys()])) {
    const m = meta.get(qid);
    const history = byQid.get(qid);
    if (!history) {
      progress.push(m!);
      continue;
    }
    const base: Progress = { ...emptyProgress(qid), flagged: m?.flagged ?? false, note: m?.note ?? '', report: m?.report ?? null };
    progress.push(history.reduce<Progress>((p, a) => ({ ...applyAttempt(p, qid, a), flagged: p.flagged, note: p.note, report: p.report }), base));
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

  const kv = new Map(incoming.kv.map((k) => [k.key, k]));
  for (const k of current.kv) kv.set(k.key, k);

  return {
    questions: [...questions.values()],
    lectures: [...lectures.values()],
    progress,
    attempts: mergedAttempts,
    sessions: [...sessions.values()],
    imports: [...imports.values()].sort((a, b) => a.importedAt - b.importedAt),
    kv: [...kv.values()],
  };
}

async function replaceAll(data: BackupData, database: QBankDB) {
  const tables = [database.questions, database.lectures, database.progress, database.attempts, database.sessions, database.imports, database.kv];
  await database.transaction('rw', tables, async () => {
    await Promise.all(tables.map((t) => t.clear()));
    await database.questions.bulkAdd(data.questions);
    await database.lectures.bulkAdd(data.lectures);
    await database.progress.bulkAdd(data.progress);
    await database.attempts.bulkAdd(data.attempts);
    await database.sessions.bulkAdd(data.sessions);
    await database.imports.bulkAdd(data.imports);
    await database.kv.bulkAdd(data.kv);
  });
}

export async function restoreBackup(file: BackupData, mode: 'replace' | 'merge', database: QBankDB = defaultDb): Promise<BackupData> {
  const data = mode === 'replace' ? file : mergeData(await readAll(database), file);
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
