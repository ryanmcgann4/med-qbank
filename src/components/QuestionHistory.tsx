import { AlertTriangle, CheckCircle2, Repeat, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { Progress } from '../db';
import { missCount } from '../lib/settings';
import { updateProgress } from '../lib/tracking';
import { Button, cn } from './ui';

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/** Before you answer: how this question has gone for you, so a past miss makes you slow down. */
export function HistoryNote({ progress: p }: { progress: Progress | undefined }) {
  const seen = p?.timesSeen ?? 0;
  const misses = missCount(p);
  let tone: 'new' | 'miss' | 'right' | 'shaky';
  let text: string;
  if (!seen) {
    tone = 'new';
    text = 'New question';
  } else if (misses > 0) {
    tone = 'miss';
    text = `${misses === 1 && p!.lastResult === 'wrong' ? 'Missed it last time' : `Missed ${times(misses)} before`} · take your time`;
  } else if (p!.lastConfidence === 'guess') {
    tone = 'shaky';
    text = `Right ${seen === 1 ? 'last time' : seen === 2 ? 'both times' : `all ${seen} times`}, but you guessed`;
  } else {
    tone = 'right';
    text = seen === 1 ? 'Got it right last time' : seen === 2 ? 'Right both times before' : `Right all ${seen} times before`;
  }
  const Icon = { new: Sparkles, miss: AlertTriangle, right: CheckCircle2, shaky: Repeat }[tone];
  return (
    <div
      className={cn(
        'mb-3 inline-flex max-w-full items-start gap-1.5 rounded-2xl px-3 py-1 text-sm font-medium',
        tone === 'new' && 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300',
        tone === 'miss' && 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200',
        tone === 'right' && 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
        tone === 'shaky' && 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {text}
        {misses > 0 && <span className="ml-1.5 whitespace-nowrap font-normal opacity-75">({p!.timesCorrect}/{seen} right)</span>}
      </span>
    </div>
  );
}

/** After a miss that reaches your leech threshold: suggest archiving it (or undo, once archived). */
export function LeechNotice({ qid, misses, archived }: { qid: string; misses: number; archived: boolean }) {
  const [kept, setKept] = useState(false);
  if (kept && !archived) return null;
  return (
    <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40">
      {archived ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto">Archived. It's out of your quizzes and stays in the Library under Archived.</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void updateProgress(qid, { archived: false })}
          >
            Undo
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-200">
            <Repeat className="h-4 w-4" /> You've missed this {times(misses)}. It's a leech.
          </div>
          <p className="mt-1 text-amber-900/80 dark:text-amber-200/80">
            A question you keep missing usually costs more time than it teaches. Archive it, or edit it below into something that sticks.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void updateProgress(qid, { archived: true })}>
              Archive it
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setKept(true)}>
              Keep it
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
