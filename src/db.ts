import Dexie, { type EntityTable } from 'dexie';
import type { Lecture, Question, QuestionType } from './schema';

export type Confidence = 'sure' | 'unsure' | 'guess';
export type Result = 'correct' | 'wrong';

export interface StoredQuestion extends Question {
  /** Normalized stem+options fingerprint used for near-duplicate detection. */
  hash: string;
  importedAt: number;
  updatedAt: number;
  /** Set when the question was edited in-app; cleared if a re-import overwrites it. */
  editedAt: number | null;
  /** The imported version, saved on the first in-app edit so it can be restored. */
  original?: Question | null;
}

export interface StoredLecture extends Lecture {
  course: string;
  week: number;
  day_label: string;
  date: string;
  importedAt: number;
}

export interface SrsState {
  /** Leitner box 1–6; see lib/srs.ts. */
  box: number;
  /** Local midnight of the day the question is next due. */
  dueAt: number;
  lastReviewedAt: number;
}

/** Your progress on one question. Keyed by qid and never touched by imports. */
export interface Progress {
  qid: string;
  timesSeen: number;
  timesCorrect: number;
  lastAnsweredAt: number | null;
  lastResult: Result | null;
  lastConfidence: Confidence | null;
  /** Consecutive correct answers. */
  streak: number;
  flagged: boolean;
  note: string;
  /** "Possibly incorrect" report, so you can check it against the lecture. */
  report: { reason: string; at: number } | null;
  srs: SrsState | null;
  /** When flag/note/report last changed; newest wins when devices sync. */
  metaUpdatedAt?: number;
}

/** Tombstone so a delete on one device propagates instead of being re-added by sync. */
export interface Deletion {
  /** `lecture:<lecture_id>` or `question:<qid>` */
  id: string;
  kind: 'lecture' | 'question';
  key: string;
  at: number;
}

export interface Attempt {
  id?: number;
  qid: string;
  ts: number;
  /** Original option id (not the shuffled display letter). Null = left blank. */
  chosen: string | null;
  correct: boolean;
  confidence: Confidence | null;
  timeMs: number;
  mode: QuizMode;
  sessionId: string;
}

export type QuizMode = 'smart' | 'unseen' | 'missed' | 'weekly' | 'exam' | 'custom';

export const STATUS_KEYS = ['unseen', 'missed', 'ever_missed', 'lucky', 'flagged', 'due', 'mastered', 'reported'] as const;
export type StatusKey = (typeof STATUS_KEYS)[number];

export interface QuizFilters {
  courses: string[];
  /** `${course}::${week}` */
  weeks: string[];
  /** `${course}::${day_label}` */
  days: string[];
  lectures: string[];
  tags: string[];
  types: QuestionType[];
  difficulties: number[];
  /** A question matches if it has ANY of these statuses. Empty = all. */
  statuses: StatusKey[];
}

export interface QuizConfig {
  mode: QuizMode;
  count: number;
  filters: QuizFilters;
  /** Skip questions answered correctly in the last N days (unless due). */
  avoidRecentDays: number;
  includeRecentCorrect: boolean;
  shuffleOptions: boolean;
  secondsPerQuestion: number;
  /** Explicit question list (e.g. "re-quiz my misses"). Overrides filters. */
  qids?: string[];
}

export interface SessionItem {
  qid: string;
  /** Original option ids in display order. Display letter = A + index. */
  order: string[];
}

export interface SessionAnswer {
  chosen: string | null;
  confidence: Confidence | null;
  timeMs: number;
  struck: string[];
  submitted: boolean;
  correct: boolean | null;
}

export interface QuizSession {
  id: string;
  title: string;
  createdAt: number;
  mode: QuizMode;
  /** Exam mode: feedback hidden until the end, countdown timer. */
  timed: boolean;
  timeLimitMs: number | null;
  config: QuizConfig;
  items: SessionItem[];
  answers: SessionAnswer[];
  current: number;
  elapsedMs: number;
  finishedAt: number | null;
}

export interface ImportRecord {
  id?: number;
  importedAt: number;
  files: { name: string; day_label: string; course: string; week: number; date: string }[];
  lectureIds: string[];
  added: number;
  overwritten: number;
  keptBoth: number;
  skipped: number;
  invalid: number;
}

export interface KV {
  key: string;
  value: unknown;
}

export class QBankDB extends Dexie {
  questions!: EntityTable<StoredQuestion, 'qid'>;
  lectures!: EntityTable<StoredLecture, 'lecture_id'>;
  progress!: EntityTable<Progress, 'qid'>;
  attempts!: EntityTable<Attempt, 'id'>;
  sessions!: EntityTable<QuizSession, 'id'>;
  imports!: EntityTable<ImportRecord, 'id'>;
  kv!: EntityTable<KV, 'key'>;
  deletions!: EntityTable<Deletion, 'id'>;

  constructor(name = 'med-qbank') {
    super(name);
    this.version(1).stores({
      questions: 'qid, lecture_id, hash, type, difficulty, *tags',
      lectures: 'lecture_id, course, week, day_label, date',
      progress: 'qid, lastAnsweredAt',
      attempts: '++id, qid, ts, sessionId',
      sessions: 'id, createdAt, finishedAt',
      imports: '++id, importedAt',
      kv: 'key',
    });
    this.version(2).stores({ deletions: 'id, at' });
  }
}

export const db = new QBankDB();

export function emptyProgress(qid: string): Progress {
  return {
    qid,
    timesSeen: 0,
    timesCorrect: 0,
    lastAnsweredAt: null,
    lastResult: null,
    lastConfidence: null,
    streak: 0,
    flagged: false,
    note: '',
    report: null,
    srs: null,
  };
}

export async function getKV<T>(key: string, fallback: T): Promise<T> {
  const row = await db.kv.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setKV(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}
