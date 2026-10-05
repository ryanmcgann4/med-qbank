/**
 * How the bank is laid out as files in the sync repo. Small, stable files so
 * a sync only uploads what changed:
 *
 *   lectures.json · imports.json · deletions.json · progress-meta.json · exams.json
 *   questions/<lecture_id>.json   attempts/<YYYY-MM-DD>.json   sessions/<id>.json
 *
 * Progress counts and scheduling aren't stored; they're rebuilt from attempts.
 */
import { emptyProgress, type Attempt, type Deletion, type Exam, type Progress, type QuizSession, type StoredQuestion } from '../../db';
import type { BackupData } from '../backup';
import { todayISO } from '../dates';

export const MANAGED = /^(lectures|imports|deletions|progress-meta|exams)\.json$|^(questions|attempts|sessions)\/[^/]+\.json$/;

/** JSON with sorted keys, one array item per line: identical data → identical bytes on every device. */
export function stableStringify(value: unknown): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  if (Array.isArray(value)) return value.length ? `[\n${value.map((x) => JSON.stringify(sortKeys(x))).join(',\n')}\n]\n` : '[]\n';
  return JSON.stringify(sortKeys(value)) + '\n';
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._~-]/g, '_');
const by = <T>(key: (t: T) => string | number) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

function group<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) m.set(key(it), [...(m.get(key(it)) ?? []), it]);
  return m;
}

export function toShards(data: BackupData): Map<string, string> {
  const files = new Map<string, string>();
  files.set('lectures.json', stableStringify([...data.lectures].sort(by((l) => l.lecture_id))));
  files.set('imports.json', stableStringify(data.imports.map(({ id: _id, ...rest }) => rest).sort(by((i) => i.importedAt))));
  files.set('exams.json', stableStringify([...(data.exams ?? [])].sort(by((e) => e.id))));
  files.set('deletions.json', stableStringify([...(data.deletions ?? [])].sort(by((d) => d.id))));
  files.set(
    'progress-meta.json',
    stableStringify(
      data.progress
        .filter((p) => p.flagged || p.note || p.report || p.metaUpdatedAt)
        .map((p) => ({ qid: p.qid, flagged: p.flagged, note: p.note, report: p.report, metaUpdatedAt: p.metaUpdatedAt }))
        .sort(by((p) => p.qid)),
    ),
  );
  for (const [lecture, qs] of group(data.questions, (q) => q.lecture_id)) {
    files.set(`questions/${safe(lecture)}.json`, stableStringify(qs.sort(by((q) => q.qid))));
  }
  for (const [day, as] of group(data.attempts, (a) => todayISO(a.ts))) {
    files.set(`attempts/${day}.json`, stableStringify(as.map(({ id: _id, ...rest }) => rest).sort(by((a) => `${a.ts}|${a.qid}`))));
  }
  for (const s of data.sessions) files.set(`sessions/${safe(s.id)}.json`, stableStringify(s));
  return files;
}

/** Parse whichever shard files were downloaded into (partial) backup data. */
export function fromShards(files: ReadonlyMap<string, string>): BackupData {
  const data: Required<BackupData> = { questions: [], lectures: [], progress: [], attempts: [], sessions: [], imports: [], kv: [], deletions: [], exams: [] };
  for (const [path, text] of files) {
    const v = JSON.parse(text);
    if (path === 'lectures.json') data.lectures.push(...v);
    else if (path === 'imports.json') data.imports.push(...v);
    else if (path === 'deletions.json') data.deletions.push(...(v as Deletion[]));
    else if (path === 'exams.json') data.exams.push(...(v as Exam[]));
    else if (path === 'progress-meta.json') data.progress.push(...(v as Partial<Progress>[]).map((m) => ({ ...emptyProgress(m.qid!), ...m })));
    else if (path.startsWith('questions/')) data.questions.push(...(v as StoredQuestion[]));
    else if (path.startsWith('attempts/')) data.attempts.push(...(v as Attempt[]));
    else if (path.startsWith('sessions/')) data.sessions.push(v as QuizSession);
  }
  return data;
}

/** Git's blob id for `content`, so unchanged files are never re-uploaded. */
export async function gitBlobSha(content: string): Promise<string> {
  const body = new TextEncoder().encode(content);
  const header = new TextEncoder().encode(`blob ${body.byteLength}\0`);
  const buf = new Uint8Array(header.byteLength + body.byteLength);
  buf.set(header);
  buf.set(body, header.byteLength);
  const hash = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
