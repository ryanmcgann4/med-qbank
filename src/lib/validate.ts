import type { z } from 'zod';
import { QBankEnvelopeSchema, QuestionSchema, type Lecture, type Question } from '../schema';

export interface Issue {
  /** Human-readable location, e.g. `Question 3 (B2-W6-D1-L1-Q003)`. */
  where: string;
  /** Field path inside that object, e.g. `options[2].explanation`. */
  field: string;
  message: string;
}

export interface SkippedQuestion {
  index: number;
  qid?: string;
  issues: Issue[];
}

export interface FileValidation {
  name: string;
  /** False when the file can't be imported at all (bad JSON or bad header). */
  ok: boolean;
  meta?: {
    format_version: string;
    generated_at?: string;
    course: string;
    week: number;
    day_label: string;
    date: string;
  };
  lectures: Lecture[];
  questions: Question[];
  fileErrors: Issue[];
  skipped: SkippedQuestion[];
  warnings: string[];
  totalQuestions: number;
}

/**
 * Pull a JSON value out of text that may be wrapped in a ```json fence or
 * have chatty text around it (common when pasting from a chat).
 */
export function extractJson(text: string): { value?: unknown; error?: string } {
  let t = text.replace(/^﻿/, '').trim();
  if (!t) return { error: 'The file is empty.' };
  const fence = t.match(/```(?:json)?\s*\n([\s\S]*?)\n?```/);
  if (fence) t = fence[1].trim();
  try {
    return { value: JSON.parse(t) };
  } catch (e) {
    const first = t.indexOf('{');
    const last = t.lastIndexOf('}');
    if (first > 0 || (last !== -1 && last < t.length - 1)) {
      try {
        return { value: JSON.parse(t.slice(first, last + 1)) };
      } catch {
        /* fall through to the original error */
      }
    }
    const msg = (e as Error).message;
    let hint = '';
    if (/end of (json )?input|Unterminated/i.test(msg) || unclosedBrackets(t) > 0) {
      hint = ' The JSON looks cut off — Claude may have hit its output limit. Ask it to output the complete file again, or split the day into two files.';
    } else if (/[“”]/.test(t)) {
      hint = ' The text contains “curly quotes”; JSON needs straight double quotes (").';
    }
    return { error: `Not valid JSON: ${msg}.${hint}` };
  }
}

/** Count of `{`/`[` still open at the end of the text (ignoring string contents). */
function unclosedBrackets(t: string): number {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  return depth;
}

export function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const p of path) {
    if (typeof p === 'number') out += `[${p}]`;
    else out += out ? `.${String(p)}` : String(p);
  }
  return out || '(root)';
}

function describeIssue(issue: z.core.$ZodIssue, root: unknown): string {
  if (issue.code === 'invalid_type') {
    const value = getAt(root, issue.path);
    if (value === undefined) return `is missing (expected ${issue.expected})`;
    return `should be ${issue.expected}, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`;
  }
  if (issue.code === 'invalid_value') {
    const value = getAt(root, issue.path);
    return `"${String(value)}" is not allowed — use one of: ${issue.values.map(String).join(', ')}`;
  }
  if (issue.code === 'too_small' || issue.code === 'too_big') {
    const value = getAt(root, issue.path);
    const custom = issue.message && !/^Too (small|big)/.test(issue.message) ? issue.message : '';
    if (custom) return custom;
    const bound = issue.code === 'too_small' ? `at least ${issue.minimum}` : `at most ${issue.maximum}`;
    return typeof value === 'number' ? `must be ${bound} (got ${value})` : `must have ${bound} ${issue.origin === 'string' ? 'characters' : 'items'}`;
  }
  return issue.message;
}

function getAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let cur: unknown = root;
  for (const p of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[p];
  }
  return cur;
}

function toIssues(error: z.ZodError, where: string, root: unknown, prefix: PropertyKey[] = []): Issue[] {
  return error.issues.map((issue) => ({
    where,
    field: formatPath([...prefix, ...issue.path]),
    message: describeIssue(issue, root),
  }));
}

/**
 * Validate a parsed file. Header problems reject the whole file; each question
 * is validated on its own so the good ones still import.
 *
 * `knownLectureIds` are lectures already in the bank, so a file may add
 * questions to a lecture imported earlier.
 */
export function validateQBank(raw: unknown, name: string, knownLectureIds: ReadonlySet<string> = new Set()): FileValidation {
  const result: FileValidation = {
    name,
    ok: false,
    lectures: [],
    questions: [],
    fileErrors: [],
    skipped: [],
    warnings: [],
    totalQuestions: 0,
  };

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    result.fileErrors.push({ where: 'File', field: '(root)', message: 'must be a JSON object with "lectures" and "questions"' });
    return result;
  }

  const env = QBankEnvelopeSchema.safeParse(raw);
  if (!env.success) {
    result.fileErrors = toIssues(env.error, 'File header', raw);
    const qs = (raw as { questions?: unknown }).questions;
    if (Array.isArray(qs)) result.totalQuestions = qs.length;
    return result;
  }

  const { questions: rawQuestions, lectures, ...meta } = env.data;
  result.ok = true;
  result.meta = meta;
  result.totalQuestions = rawQuestions.length;

  const lectureIds = new Set<string>();
  lectures.forEach((l, i) => {
    if (lectureIds.has(l.lecture_id)) {
      result.warnings.push(`Lecture ${i + 1} reuses lecture_id "${l.lecture_id}"; the later entry wins.`);
    }
    lectureIds.add(l.lecture_id);
  });
  result.lectures = [...new Map(lectures.map((l) => [l.lecture_id, l])).values()];

  const seenQids = new Set<string>();
  rawQuestions.forEach((rq, index) => {
    const rawQid = rq && typeof rq === 'object' ? (rq as { qid?: unknown }).qid : undefined;
    const qid = typeof rawQid === 'string' && rawQid.trim() ? rawQid.trim() : undefined;
    const where = `Question ${index + 1}${qid ? ` (${qid})` : ''}`;
    const parsed = QuestionSchema.safeParse(rq);
    if (!parsed.success) {
      result.skipped.push({ index, qid, issues: toIssues(parsed.error, where, rq) });
      return;
    }
    const q = parsed.data;
    const issues: Issue[] = [];
    if (!lectureIds.has(q.lecture_id) && !knownLectureIds.has(q.lecture_id)) {
      issues.push({
        where,
        field: 'lecture_id',
        message: `"${q.lecture_id}" doesn't match any lecture in this file (${[...lectureIds].join(', ')})`,
      });
    }
    if (seenQids.has(q.qid)) {
      issues.push({ where, field: 'qid', message: `"${q.qid}" appears more than once in this file` });
    }
    if (issues.length) {
      result.skipped.push({ index, qid, issues });
      return;
    }
    seenQids.add(q.qid);
    result.questions.push(q);
  });

  for (const l of result.lectures) {
    if (!result.questions.some((q) => q.lecture_id === l.lecture_id) && !result.skipped.length) {
      result.warnings.push(`Lecture "${l.title}" (${l.lecture_id}) has no questions.`);
    }
  }

  return result;
}

export function validateText(text: string, name: string, knownLectureIds?: ReadonlySet<string>): FileValidation {
  const { value, error } = extractJson(text);
  if (error) {
    return {
      name,
      ok: false,
      lectures: [],
      questions: [],
      fileErrors: [{ where: 'File', field: '(root)', message: error }],
      skipped: [],
      warnings: [],
      totalQuestions: 0,
    };
  }
  return validateQBank(value, name, knownLectureIds);
}
