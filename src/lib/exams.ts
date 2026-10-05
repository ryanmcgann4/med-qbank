import { db as defaultDb, type Attempt, type Exam, type QBankDB } from '../db';
import { addDays, DAY_MS, daysBetween, startOfDay, todayISO } from './dates';
import { randomId, shuffle } from './rng';
import { weekKey, type Candidate } from './selection';
import { hasStatus } from './status';

export interface ExamPlan {
  /** Calendar days from today to the exam (0 = exam is today). */
  daysLeft: number;
  total: number;
  seen: number;
  mastered: number;
  /** Accuracy over the last 7 days on this exam's questions. */
  recentAccuracy: number | null;
  /** First-time questions: today's target and how many are done. */
  newTarget: number;
  newDone: number;
  /** Reviews: due now plus those already done today. */
  reviewTarget: number;
  reviewDone: number;
  /** Questions still to do today. */
  remaining: number;
  /** Day the first pass through every question finishes at this pace. */
  firstPassBy: string;
  /** The qids that make up the rest of today's plan (due first, then new). */
  todayQids: string[];
}

export const inExam = (c: Candidate, exam: Exam) =>
  !!c.lecture && c.lecture.course === exam.course && (exam.weeks.length === 0 || exam.weeks.includes(weekKey(c.lecture.course, c.lecture.week)));

/** Final days held back for review only, so the first pass finishes early. */
export function reviewDays(studyDays: number): number {
  return studyDays >= 7 ? 2 : studyDays >= 4 ? 1 : 0;
}

/**
 * Today's share of the work: spread the not-yet-seen questions evenly over the
 * days left (minus the review buffer), plus whatever the scheduler has due.
 * Targets are computed as of the start of today, so they don't shrink as you work.
 */
export function planFor(exam: Exam, cands: readonly Candidate[], attempts: readonly Attempt[], now = Date.now()): ExamPlan {
  const pool = cands.filter((c) => inExam(c, exam));
  const ids = new Set(pool.map((c) => c.q.qid));
  const today = startOfDay(now);
  const examDay = new Date(exam.date + 'T00:00:00').getTime();
  const daysLeft = daysBetween(now, examDay);

  const first = new Map<string, number>();
  const answeredToday = new Set<string>();
  let recentN = 0;
  let recentRight = 0;
  for (const a of attempts) {
    if (!ids.has(a.qid)) continue;
    if (!first.has(a.qid) || a.ts < first.get(a.qid)!) first.set(a.qid, a.ts);
    if (a.ts >= today) answeredToday.add(a.qid);
    if (a.ts >= now - 7 * DAY_MS) {
      recentN++;
      if (a.correct) recentRight++;
    }
  }
  const newDone = [...answeredToday].filter((q) => first.get(q)! >= today).length;
  const reviewDone = answeredToday.size - newDone;

  const unseen = pool.filter((c) => hasStatus(c.progress, 'unseen', now));
  const due = pool.filter((c) => hasStatus(c.progress, 'due', now));
  const studyDays = Math.max(0, daysLeft);
  const newDays = Math.max(1, studyDays - reviewDays(studyDays));
  const unseenAtStart = unseen.length + newDone;
  const newTarget = studyDays > 0 ? Math.min(unseenAtStart, Math.ceil(unseenAtStart / newDays)) : 0;
  const newLeft = Math.max(0, newTarget - newDone);

  const todayQids = [...due.sort((a, b) => a.progress!.srs!.dueAt - b.progress!.srs!.dueAt), ...shuffle(unseen).slice(0, newLeft)].map((c) => c.q.qid);

  return {
    daysLeft,
    total: pool.length,
    seen: pool.length - unseen.length,
    mastered: pool.filter((c) => hasStatus(c.progress, 'mastered', now)).length,
    recentAccuracy: recentN ? recentRight / recentN : null,
    newTarget,
    newDone,
    reviewTarget: reviewDone + due.length,
    reviewDone,
    remaining: newLeft + due.length,
    firstPassBy: todayISO(addDays(now, newTarget ? Math.ceil(unseenAtStart / newTarget) - 1 : 0)),
    todayQids,
  };
}

export async function saveExam(exam: Omit<Exam, 'id' | 'updatedAt'> & { id?: string }, database: QBankDB = defaultDb): Promise<Exam> {
  const full: Exam = { ...exam, id: exam.id ?? randomId(), updatedAt: Date.now() };
  await database.exams.put(full);
  return full;
}

export async function deleteExam(id: string, database: QBankDB = defaultDb): Promise<void> {
  await database.transaction('rw', [database.exams, database.deletions], async () => {
    await database.exams.delete(id);
    await database.deletions.put({ id: `exam:${id}`, kind: 'exam', key: id, at: Date.now() });
  });
}

/** Exams from today onward, soonest first. */
export const upcoming = (exams: readonly Exam[], now = Date.now()) =>
  exams.filter((e) => e.date >= todayISO(now)).sort((a, b) => a.date.localeCompare(b.date));
