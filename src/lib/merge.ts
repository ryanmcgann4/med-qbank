import type { Attempt, Deletion, Exam, Folder, ImportRecord, KV, Progress, QuizSession, StoredLecture, StoredQuestion } from '../db';
import { applyAttempt, emptyProgress } from './progress';

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
  exams?: Exam[];
  folders?: Folder[];
}

/** Device-local keys (sync bookkeeping) never leave this browser in a backup. */
export const isDeviceKey = (key: string) => key.startsWith('sync');

export const importKey = (i: ImportRecord) => `${i.importedAt}|${i.files.map((f) => f.name).join(',')}`;

/** Two attempts with the same key are the same answer (e.g. one copy from each device). */
export const attemptKey = (a: Attempt) => `${a.qid}|${a.ts}|${a.sessionId}|${a.chosen}`;

type Meta = Pick<Progress, 'flagged' | 'note' | 'report' | 'archived' | 'metaUpdatedAt'>;
const metaOf = (p: Progress): Meta => ({ flagged: p.flagged, note: p.note, report: p.report, archived: p.archived, metaUpdatedAt: p.metaUpdatedAt });

/** Newest flag/note/report wins. Without timestamps (old backups), keep whatever is set. */
function mergeMeta(a: Meta, b: Meta): Meta {
  const ta = a.metaUpdatedAt ?? 0;
  const tb = b.metaUpdatedAt ?? 0;
  if (ta !== tb) return ta > tb ? a : b;
  return {
    flagged: a.flagged || b.flagged,
    note: a.note || b.note,
    report: a.report ?? b.report,
    archived: a.archived || b.archived || undefined,
    metaUpdatedAt: ta || undefined,
  };
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

  // Imported content follows the newest import; your rename and folder each follow your newest change.
  const lectures = new Map(current.lectures.map((l) => [l.lecture_id, l]));
  for (const l of incoming.lectures) {
    const mine = lectures.get(l.lecture_id);
    if (!mine) {
      lectures.set(l.lecture_id, l);
      continue;
    }
    const base = l.importedAt > mine.importedAt ? l : mine;
    const named = (l.renamedAt ?? 0) > (mine.renamedAt ?? 0) ? l : mine;
    const filed = (l.movedAt ?? 0) > (mine.movedAt ?? 0) ? l : mine;
    lectures.set(l.lecture_id, {
      ...base,
      ...(named.renamedAt ? { title: named.title, renamedAt: named.renamedAt, importedTitle: named.importedTitle } : {}),
      // A deliberate move to the top level is null, which must not fall back to an auto folder.
      folderId: filed.movedAt ? filed.folderId : (base.folderId ?? (base === l ? mine : l).folderId),
      movedAt: filed.movedAt,
    });
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

  const imports = new Map<string, ImportRecord>();
  for (const i of [...current.imports, ...incoming.imports]) {
    const { id: _id, ...rest } = i;
    void _id;
    if (!imports.has(importKey(i))) imports.set(importKey(i), rest);
  }

  const exams = new Map((current.exams ?? []).map((e) => [e.id, e]));
  for (const e of incoming.exams ?? []) {
    const mine = exams.get(e.id);
    if (!mine || e.updatedAt > mine.updatedAt) exams.set(e.id, e);
  }
  for (const [id, e] of exams) if (deletedAt('exam', id) >= e.updatedAt) exams.delete(id);

  const folders = new Map((current.folders ?? []).map((f) => [f.id, f]));
  for (const f of incoming.folders ?? []) {
    const mine = folders.get(f.id);
    if (!mine || f.updatedAt > mine.updatedAt) folders.set(f.id, f);
  }
  for (const [id, f] of folders) if (deletedAt('folder', id) >= f.updatedAt) folders.delete(id);

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
    exams: [...exams.values()],
    folders: [...folders.values()],
  };
}
