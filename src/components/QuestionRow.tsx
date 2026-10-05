import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';
import { db, type Progress, type StoredQuestion } from '../db';
import { daysBetween, formatDate, formatDuration, relativeDay } from '../lib/dates';
import type { Candidate } from '../lib/selection';
import { BOX_INTERVAL_DAYS } from '../lib/srs';
import { hasStatus } from '../lib/status';
import { CONFIDENCE_LABEL, QuestionView } from './QuestionView';
import { QuestionTools } from './QuestionTools';
import { Badge, Card, cn } from './ui';

export function highlight(text: string, terms: readonly string[]): ReactNode {
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text.split(re).map((part, i) =>
    i % 2 ? (
      <mark key={i} className="rounded bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-700/60">
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

export function StatusBadges({ q, p, now = Date.now() }: { q: StoredQuestion; p?: Progress; now?: number }) {
  return (
    <>
      {hasStatus(p, 'unseen', now) && <Badge>Unseen</Badge>}
      {hasStatus(p, 'missed', now) && <Badge tone="red">Missed</Badge>}
      {hasStatus(p, 'lucky', now) && <Badge tone="amber">Lucky guess</Badge>}
      {hasStatus(p, 'mastered', now) && <Badge tone="green">Mastered</Badge>}
      {hasStatus(p, 'due', now) && <Badge tone="indigo">Due</Badge>}
      {p && p.timesSeen > 0 && (
        <Badge>
          {p.timesCorrect}/{p.timesSeen} correct
        </Badge>
      )}
      {p?.flagged && <Badge tone="amber">Flagged</Badge>}
      {p?.report && <Badge tone="red">Reported</Badge>}
      {q.editedAt && <Badge tone="sky">Edited</Badge>}
    </>
  );
}

export function QuestionRow({ c, terms = [], showLecture = true }: { c: Candidate; terms?: string[]; showLecture?: boolean }) {
  const [open, setOpen] = useState(false);
  const { q, lecture, progress: p } = c;
  return (
    <Card className={cn(open && 'ring-1 ring-indigo-300 dark:ring-indigo-800')}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-3 p-4 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadges q={q} p={p} />
          </span>
          <span className="mt-1.5 line-clamp-2 block text-sm">{highlight(q.stem, terms)}</span>
          <span className="mt-0.5 block text-xs text-slate-500">
            {showLecture && lecture ? `${lecture.title} · ` : ''}
            {q.qid}
          </span>
        </span>
        <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-slate-100 p-4 dark:border-slate-800">
          <QuestionView
            question={q}
            lecture={lecture}
            order={q.options.map((o) => o.id)}
            answer={{ chosen: null, confidence: null, timeMs: 0, struck: [], submitted: true, correct: null }}
            revealed
            browse
            interactive={false}
            footer={
              <>
                <History qid={q.qid} p={p} />
                <QuestionTools question={q} />
              </>
            }
          />
        </div>
      )}
    </Card>
  );
}

function dueLabel(dueAt: number, now = Date.now()): string {
  if (dueAt > now) return relativeDay(dueAt, now);
  const late = daysBetween(dueAt, now);
  return late > 0 ? `due now (${late} day${late === 1 ? '' : 's'} overdue)` : 'due today';
}

function History({ qid, p }: { qid: string; p?: Progress }) {
  const attempts = useLiveQuery(() => db.attempts.where('qid').equals(qid).sortBy('ts'), [qid]);
  if (!p?.timesSeen) return <p className="text-sm text-slate-500">Not answered yet.</p>;
  return (
    <div className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-slate-600 dark:text-slate-400">
        <span>
          Last answered <b className="text-slate-900 dark:text-slate-100">{formatDate(p.lastAnsweredAt)}</b>
        </span>
        {p.srs && (
          <span>
            Next review <b className="text-slate-900 dark:text-slate-100">{dueLabel(p.srs.dueAt)}</b> (box {p.srs.box}, {BOX_INTERVAL_DAYS[p.srs.box]}-day interval)
          </span>
        )}
      </div>
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-1 font-medium">When</th>
            <th className="py-1 font-medium">Chose</th>
            <th className="py-1 font-medium">Result</th>
            <th className="py-1 font-medium">Confidence</th>
            <th className="py-1 text-right font-medium">Time</th>
          </tr>
        </thead>
        <tbody>
          {attempts?.map((a) => (
            <tr key={a.id} className="border-t border-slate-100 dark:border-slate-800">
              <td className="py-1">{formatDate(a.ts)}</td>
              <td className="py-1">{a.chosen ?? '—'}</td>
              <td className={cn('py-1 font-medium', a.correct ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400')}>
                {a.correct ? '✓ Correct' : '✗ Wrong'}
              </td>
              <td className="py-1">{a.confidence ? CONFIDENCE_LABEL[a.confidence] : '—'}</td>
              <td className="py-1 text-right tabular-nums">{formatDuration(a.timeMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-slate-500">"Chose" shows the original option letter as listed above.</p>
    </div>
  );
}
