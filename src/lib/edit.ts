import type { StoredQuestion } from '../db';
import { QuestionSchema, type Question } from '../schema';
import { contentHash } from './hash';
import { formatPath } from './validate';

const CONTENT_KEYS = [
  'qid', 'lecture_id', 'type', 'difficulty', 'stem', 'options', 'correct_option',
  'explanation', 'key_takeaway', 'source', 'tags', 'image_url',
] as const;

export function questionContent(q: Question): Question {
  const out = {} as Record<string, unknown>;
  for (const k of CONTENT_KEYS) out[k] = q[k];
  return out as unknown as Question;
}

export class EditError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super(issues.join('; '));
    this.issues = issues;
  }
}

/** Validate an in-app edit and return the updated record (qid can't change). */
export function applyEdit(q: StoredQuestion, edited: Question, now = Date.now()): StoredQuestion {
  const parsed = QuestionSchema.safeParse({ ...edited, qid: q.qid });
  if (!parsed.success) {
    throw new EditError(parsed.error.issues.map((i) => `${formatPath(i.path)}: ${i.message}`));
  }
  return {
    ...q,
    ...parsed.data,
    hash: contentHash(parsed.data),
    updatedAt: now,
    editedAt: now,
    original: q.original ?? questionContent(q),
  };
}

/** Undo all in-app edits, back to the imported version. */
export function revertEdit(q: StoredQuestion, now = Date.now()): StoredQuestion {
  if (!q.original) return q;
  return { ...q, ...q.original, hash: contentHash(q.original), updatedAt: now, editedAt: null, original: null };
}
