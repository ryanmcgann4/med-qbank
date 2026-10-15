import { db as defaultDb, emptyProgress, type Attempt, type Progress, type QBankDB, type QuizConfig, type QuizSession } from '../db';
import { attemptKey } from './merge';
import { buildSession, selectQuestions, type Candidate } from './selection';
import { applyAttempt } from './progress';
import { releasedByExams } from './exams';
import { DEFAULT_NEW_FIRST, getSetting, NEW_FIRST_KEY } from './settings';

export { applyAttempt };

export async function recordAttempts(attempts: Omit<Attempt, 'id'>[], database: QBankDB = defaultDb): Promise<void> {
  if (!attempts.length) return;
  await database.transaction('rw', [database.attempts, database.progress], async () => {
    for (const a of attempts) {
      const prev = await database.progress.get(a.qid);
      await database.progress.put(applyAttempt(prev, a.qid, a));
      await database.attempts.add(a);
    }
  });
}

/**
 * Take back an answer: remove it, rebuild that question's progress from the
 * answers left, and leave a tombstone so another device's copy doesn't sync it back.
 */
export async function undoAttempt(a: Pick<Attempt, 'qid' | 'ts' | 'sessionId'>, database: QBankDB = defaultDb): Promise<void> {
  await database.transaction('rw', [database.attempts, database.progress, database.deletions], async () => {
    const mine = await database.attempts.where('qid').equals(a.qid).toArray();
    const gone = mine.filter((x) => x.ts === a.ts && x.sessionId === a.sessionId);
    if (!gone.length) return;
    await database.attempts.bulkDelete(gone.map((x) => x.id!));
    await database.deletions.bulkPut(gone.map((x) => ({ id: `attempt:${attemptKey(x)}`, kind: 'attempt' as const, key: attemptKey(x), at: Date.now() })));
    const prev = (await database.progress.get(a.qid)) ?? emptyProgress(a.qid);
    const meta = { flagged: prev.flagged, note: prev.note, report: prev.report, archived: prev.archived, metaUpdatedAt: prev.metaUpdatedAt };
    const left = mine.filter((x) => !gone.includes(x)).sort((x, y) => x.ts - y.ts);
    await database.progress.put(left.reduce<Progress>((p, x) => ({ ...applyAttempt(p, a.qid, x), ...meta }), { ...emptyProgress(a.qid), ...meta }));
  });
}

export async function updateProgress(qid: string, patch: Partial<Omit<Progress, 'qid'>>, database: QBankDB = defaultDb): Promise<void> {
  await database.transaction('rw', database.progress, async () => {
    const prev = (await database.progress.get(qid)) ?? emptyProgress(qid);
    const meta = 'flagged' in patch || 'note' in patch || 'report' in patch || 'archived' in patch;
    await database.progress.put({ ...prev, ...patch, qid, ...(meta ? { metaUpdatedAt: Date.now() } : {}) });
  });
}

/** Archive or unarchive every question in these lectures at once. Returns how many questions changed. */
export async function setLecturesArchived(lectureIds: readonly string[], archived: boolean, database: QBankDB = defaultDb): Promise<number> {
  const qids = (await database.questions.where('lecture_id').anyOf([...lectureIds]).primaryKeys()) as string[];
  await database.transaction('rw', database.progress, async () => {
    for (const qid of qids) await updateProgress(qid, { archived }, database);
  });
  return qids.length;
}

/** Archived questions are left out unless asked for (only the Library shows them). */
export async function loadCandidates(database: QBankDB = defaultDb, { includeArchived = false } = {}): Promise<Candidate[]> {
  const [questions, lectures, progress] = await Promise.all([
    database.questions.toArray(),
    database.lectures.toArray(),
    database.progress.toArray(),
  ]);
  const lec = new Map(lectures.map((l) => [l.lecture_id, l]));
  const prog = new Map(progress.map((p) => [p.qid, p]));
  return questions
    .map((q) => ({ q, lecture: lec.get(q.lecture_id), progress: prog.get(q.qid) }))
    .filter((c) => includeArchived || !c.progress?.archived);
}

export async function createQuiz(config: QuizConfig, title?: string, database: QBankDB = defaultDb): Promise<QuizSession | null> {
  const now = Date.now();
  const newFirst = await getSetting(NEW_FIRST_KEY, DEFAULT_NEW_FIRST, database);
  const released = releasedByExams(await database.exams.toArray(), now);
  const picked = selectQuestions(await loadCandidates(database), config, now, Math.random, { newFirst, released });
  if (!picked.length) return null;
  const session = buildSession(picked, config, now, Math.random, title);
  await database.sessions.put(session);
  return session;
}
