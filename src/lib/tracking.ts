import { db as defaultDb, emptyProgress, type Attempt, type Confidence, type Progress, type QBankDB, type QuizConfig, type QuizSession } from '../db';
import { buildSession, selectQuestions, type Candidate } from './selection';
import { schedule } from './srs';

/** Fold one answer into a question's progress record (pure). */
export function applyAttempt(
  prev: Progress | undefined,
  qid: string,
  a: { correct: boolean; confidence: Confidence | null; ts: number },
): Progress {
  const p = prev ?? emptyProgress(qid);
  return {
    ...p,
    timesSeen: p.timesSeen + 1,
    timesCorrect: p.timesCorrect + (a.correct ? 1 : 0),
    lastAnsweredAt: a.ts,
    lastResult: a.correct ? 'correct' : 'wrong',
    lastConfidence: a.confidence,
    streak: a.correct ? p.streak + 1 : 0,
    srs: schedule(p.srs, a.correct, a.confidence, a.ts),
  };
}

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

export async function updateProgress(qid: string, patch: Partial<Omit<Progress, 'qid'>>, database: QBankDB = defaultDb): Promise<void> {
  await database.transaction('rw', database.progress, async () => {
    const prev = (await database.progress.get(qid)) ?? emptyProgress(qid);
    await database.progress.put({ ...prev, ...patch, qid });
  });
}

export async function loadCandidates(database: QBankDB = defaultDb): Promise<Candidate[]> {
  const [questions, lectures, progress] = await Promise.all([
    database.questions.toArray(),
    database.lectures.toArray(),
    database.progress.toArray(),
  ]);
  const lec = new Map(lectures.map((l) => [l.lecture_id, l]));
  const prog = new Map(progress.map((p) => [p.qid, p]));
  return questions.map((q) => ({ q, lecture: lec.get(q.lecture_id), progress: prog.get(q.qid) }));
}

export async function createQuiz(config: QuizConfig, title?: string, database: QBankDB = defaultDb): Promise<QuizSession | null> {
  const now = Date.now();
  const picked = selectQuestions(await loadCandidates(database), config, now);
  if (!picked.length) return null;
  const session = buildSession(picked, config, now, Math.random, title);
  await database.sessions.put(session);
  return session;
}
