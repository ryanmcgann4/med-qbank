import type { Confidence, Progress } from '../db';
import { schedule } from './srs';

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
