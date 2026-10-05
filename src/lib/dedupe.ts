import type { Question } from '../schema';
import { contentHash } from './hash';

/**
 * - new: not in the bank
 * - identical: same qid, same content (nothing to do)
 * - qid_conflict: same qid, different content
 * - content_duplicate: different qid, same normalized stem+options
 * - batch_duplicate: repeats another question in this same import
 */
export type MatchKind = 'new' | 'identical' | 'qid_conflict' | 'content_duplicate' | 'batch_duplicate';
export type Resolution = 'add' | 'skip' | 'overwrite' | 'keep_both';

export interface ExistingQuestion extends Question {
  hash: string;
  editedAt: number | null;
}

export interface Classified<E extends ExistingQuestion = ExistingQuestion> {
  question: Question;
  hash: string;
  kind: MatchKind;
  fileIndex: number;
  existing?: E;
  /** For batch duplicates: the qid it repeats. */
  dupOf?: string;
}

const CONTENT_KEYS = [
  'lecture_id',
  'type',
  'difficulty',
  'stem',
  'options',
  'correct_option',
  'explanation',
  'key_takeaway',
  'source',
  'tags',
  'image_url',
] as const;

function canonical(q: Question): string {
  const pick: Record<string, unknown> = {};
  for (const k of CONTENT_KEYS) pick[k] = q[k] ?? null;
  pick.source = { slides: q.source.slides, objective: q.source.objective ?? null };
  pick.options = q.options.map((o) => ({ id: o.id, text: o.text, explanation: o.explanation }));
  return JSON.stringify(pick);
}

export function sameContent(a: Question, b: Question): boolean {
  return canonical(a) === canonical(b);
}

export function classifyQuestions<E extends ExistingQuestion>(
  batch: readonly { question: Question; fileIndex: number }[],
  existing: readonly E[],
): Classified<E>[] {
  const byQid = new Map(existing.map((q) => [q.qid, q]));
  const byHash = new Map<string, E>();
  for (const q of existing) if (!byHash.has(q.hash)) byHash.set(q.hash, q);

  const batchQids = new Set<string>();
  const batchHashes = new Map<string, string>();

  return batch.map(({ question, fileIndex }) => {
    const hash = contentHash(question);
    let out: Classified<E>;
    // Matches against the bank win over in-batch content matches: they're the ones you can act on.
    if (batchQids.has(question.qid)) {
      out = { question, hash, fileIndex, kind: 'batch_duplicate', dupOf: question.qid };
    } else if (byQid.has(question.qid)) {
      const ex = byQid.get(question.qid)!;
      out = { question, hash, fileIndex, existing: ex, kind: sameContent(ex, question) ? 'identical' : 'qid_conflict' };
    } else if (byHash.has(hash)) {
      out = { question, hash, fileIndex, existing: byHash.get(hash)!, kind: 'content_duplicate' };
    } else if (batchHashes.has(hash)) {
      out = { question, hash, fileIndex, kind: 'batch_duplicate', dupOf: batchHashes.get(hash) };
    } else {
      out = { question, hash, fileIndex, kind: 'new' };
    }
    batchQids.add(question.qid);
    if (!batchHashes.has(hash)) batchHashes.set(hash, question.qid);
    return out;
  });
}

/** Safe default: only brand-new questions are added; anything matching is skipped until you choose. */
export function defaultResolution(kind: MatchKind): Resolution {
  return kind === 'new' ? 'add' : 'skip';
}

export function allowedResolutions(kind: MatchKind): Resolution[] {
  switch (kind) {
    case 'new':
      return ['add', 'skip'];
    case 'qid_conflict':
    case 'content_duplicate':
      return ['skip', 'overwrite', 'keep_both'];
    default:
      return ['skip'];
  }
}

/** `B2-W6-D1-L1-Q001` → `B2-W6-D1-L1-Q001~2` (or ~3, ...) if taken. */
export function freeQid(base: string, taken: ReadonlySet<string>): string {
  for (let n = 2; ; n++) {
    const candidate = `${base}~${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface FieldDiff {
  field: string;
  before: string;
  after: string;
}

export function diffQuestion(before: Question, after: Question): FieldDiff[] {
  const out: FieldDiff[] = [];
  const add = (field: string, a: unknown, b: unknown) => {
    const sa = a === undefined || a === null ? '' : String(a);
    const sb = b === undefined || b === null ? '' : String(b);
    if (sa !== sb) out.push({ field, before: sa, after: sb });
  };
  add('qid', before.qid, after.qid);
  add('lecture', before.lecture_id, after.lecture_id);
  add('type', before.type, after.type);
  add('difficulty', before.difficulty, after.difficulty);
  add('stem', before.stem, after.stem);
  const ids = [...new Set([...before.options.map((o) => o.id), ...after.options.map((o) => o.id)])].sort();
  for (const id of ids) {
    const a = before.options.find((o) => o.id === id);
    const b = after.options.find((o) => o.id === id);
    add(`option ${id}`, a?.text, b?.text);
    add(`option ${id} explanation`, a?.explanation, b?.explanation);
  }
  add('correct answer', before.correct_option, after.correct_option);
  add('explanation', before.explanation, after.explanation);
  add('key takeaway', before.key_takeaway, after.key_takeaway);
  add('slides', before.source.slides, after.source.slides);
  add('objective', before.source.objective, after.source.objective);
  add('tags', before.tags.join(', '), after.tags.join(', '));
  add('image', before.image_url, after.image_url);
  return out;
}

export type DiffPart = { type: 'same' | 'add' | 'del'; text: string };

/** Word-level diff (LCS) for highlighting what changed in a field. */
export function diffWords(a: string, b: string): DiffPart[] {
  const ta = a.split(/(\s+)/).filter(Boolean);
  const tb = b.split(/(\s+)/).filter(Boolean);
  if (ta.length * tb.length > 250_000) {
    return [
      { type: 'del', text: a },
      { type: 'add', text: b },
    ];
  }
  const n = ta.length;
  const m = tb.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const parts: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ta[i] === tb[j]) {
      push('same', ta[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('del', ta[i++]);
    } else {
      push('add', tb[j++]);
    }
  }
  while (i < n) push('del', ta[i++]);
  while (j < m) push('add', tb[j++]);
  return parts;
}
