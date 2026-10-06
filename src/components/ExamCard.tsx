import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarClock, CheckCircle2, Pencil, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { db, type Exam, type StoredLecture } from '../db';
import { useStartQuiz } from '../hooks/useStartQuiz';
import { formatDate, todayISO } from '../lib/dates';
import { planFor, upcoming, type ExamPlan } from '../lib/exams';
import { deleteExam, saveExam } from '../lib/examStore';
import { autoNames } from '../lib/org';
import { weekKey, type Candidate } from '../lib/selection';
import { Button, Card, Chip, cn, Field, inputClass, Modal, pct } from './ui';

const dayName = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/** Countdown + today's plan for upcoming exams, or a prompt to add one. */
export function ExamCards({ cands }: { cands: Candidate[] }) {
  const exams = useLiveQuery(() => db.exams.toArray(), []);
  const attempts = useLiveQuery(() => db.attempts.toArray(), []);
  const lectures = useLiveQuery(() => db.lectures.toArray(), []);
  const [editing, setEditing] = useState<Exam | 'new' | null>(null);
  const [now] = useState(() => Date.now());

  if (!exams || !attempts || !lectures) return null;
  const next = upcoming(exams, now).slice(0, 2);

  return (
    <div className="mb-6 space-y-3">
      {next.map((e) => (
        <ExamCard key={e.id} exam={e} plan={planFor(e, cands, attempts, now)} onEdit={() => setEditing(e)} />
      ))}
      {next.length === 0 ? (
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 p-4 text-left text-sm text-slate-600 hover:border-indigo-400 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:text-white"
        >
          <CalendarClock className="h-5 w-5 shrink-0 text-indigo-600" />
          <span>
            <b>Exam coming up?</b> Add the date and get a countdown with a daily target that finishes your first pass a couple of days early.
          </span>
        </button>
      ) : (
        <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white">
          <Plus className="h-4 w-4" /> Add another exam
        </button>
      )}
      {editing && <ExamModal exam={editing === 'new' ? null : editing} lectures={lectures} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ExamCard({ exam, plan: p, onEdit }: { exam: Exam; plan: ExamPlan; onEdit: () => void }) {
  const { start, busy, message } = useStartQuiz();
  const when = p.daysLeft === 0 ? 'today' : p.daysLeft === 1 ? 'tomorrow' : `in ${p.daysLeft} days`;
  const doneToday = p.remaining === 0;
  const firstPassDone = p.seen === p.total;

  return (
    <Card className="border-indigo-200 p-4 sm:p-5 dark:border-indigo-900">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-slate-600 dark:text-slate-400">{exam.name}</div>
          <div className="text-2xl font-semibold tracking-tight">
            {p.daysLeft === 0 ? 'Exam day' : when.charAt(0).toUpperCase() + when.slice(1)}
            <span className="ml-2 text-base font-normal text-slate-500">{dayName(exam.date)}</span>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onEdit} aria-label="Edit exam">
          <Pencil className="h-4 w-4" />
        </Button>
      </div>

      {p.total === 0 ? (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">No questions match this exam yet. Import that block's lectures and they'll show up here.</p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Bar label="New today" done={p.newDone} target={p.newTarget} />
            <Bar label="Reviews today" done={p.reviewDone} target={p.reviewTarget} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {doneToday ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-5 w-5" /> Today's plan is done
              </span>
            ) : (
              <Button
                size="lg"
                disabled={busy}
                onClick={() =>
                  start({ mode: 'custom', qids: p.todayQids, count: p.todayQids.length, includeRecentCorrect: true }, `${exam.name} · today's plan`)
                }
              >
                Start today's plan ({p.remaining})
              </Button>
            )}
            <span className="text-sm text-slate-600 dark:text-slate-400">
              {firstPassDone ? 'First pass complete' : `First pass done by ${dayName(p.firstPassBy)}`}
            </span>
          </div>
          {message && <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{message}</p>}
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-100 pt-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
            <span>
              Seen <b className="text-slate-900 dark:text-slate-100">{p.seen}</b>/{p.total} ({pct(p.seen / p.total)})
            </span>
            <span>
              Mastered <b className="text-slate-900 dark:text-slate-100">{p.mastered}</b>
            </span>
            <span>
              Last 7 days <b className="text-slate-900 dark:text-slate-100">{pct(p.recentAccuracy)}</b>
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

function Bar({ label, done, target }: { label: string; done: number; target: number }) {
  const frac = target ? Math.min(1, done / target) : 1;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-slate-600 dark:text-slate-400">{label}</span>
        <span className="font-semibold tabular-nums">
          {done}/{target}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--series-1)_18%,transparent)]" aria-hidden>
        <div className={cn('h-full rounded-full', frac >= 1 ? 'bg-[var(--series-2)]' : 'bg-[var(--series-1)]')} style={{ width: `${frac * 100}%` }} />
      </div>
    </div>
  );
}

function ExamModal({ exam, lectures, onClose }: { exam: Exam | null; lectures: StoredLecture[]; onClose: () => void }) {
  const courses = useMemo(() => [...new Set(lectures.map((l) => l.course))].sort(), [lectures]);
  const folders = useLiveQuery(() => db.folders.toArray(), []);
  const names = useMemo(() => autoNames(folders ?? []), [folders]);
  const [name, setName] = useState(exam?.name ?? (courses[0] ? `${courses[0]} exam` : ''));
  const [date, setDate] = useState(exam?.date ?? '');
  const [course, setCourse] = useState(exam?.course ?? courses[0] ?? '');
  const [weeks, setWeeks] = useState<string[]>(exam?.weeks ?? []);
  const weekOptions = useMemo(
    () => [...new Set(lectures.filter((l) => l.course === course).map((l) => l.week))].sort((a, b) => a - b).map((w) => weekKey(course, w)),
    [lectures, course],
  );
  const valid = name.trim() && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= todayISO() && course.trim();

  async function save() {
    if (!valid) return;
    await saveExam({ id: exam?.id, name: name.trim(), date, course: course.trim(), weeks });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={exam ? 'Edit exam' : 'Add an exam'}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Block 2 exam" />
          </Field>
          <Field label="Date">
            <input type="date" className={inputClass} value={date} min={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Course">
          {courses.length ? (
            <select
              className={inputClass}
              value={course}
              onChange={(e) => {
                setCourse(e.target.value);
                setWeeks([]);
              }}
            >
              {courses.map((c) => (
                <option key={c} value={c}>
                  {names.course(c)}
                </option>
              ))}
            </select>
          ) : (
            <input className={inputClass} value={course} onChange={(e) => setCourse(e.target.value)} placeholder="Block 2" />
          )}
        </Field>
        <div>
          <div className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Weeks covered</div>
          <div className="flex flex-wrap gap-2">
            <Chip selected={weeks.length === 0} onClick={() => setWeeks([])}>
              All weeks
            </Chip>
            {weekOptions.map((k) => (
              <Chip key={k} selected={weeks.includes(k)} onClick={() => setWeeks(weeks.includes(k) ? weeks.filter((w) => w !== k) : [...weeks, k])}>
                {names.week(course, Number(k.split('::')[1]))}
              </Chip>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">"All weeks" includes lectures you import later, so the plan grows as the block goes on.</p>
        </div>
        {date && date < todayISO() && <p className="text-sm text-rose-600">Pick a date from today on.</p>}
        <div className="flex items-center gap-2 pt-2">
          {exam && (
            <Button
              variant="ghost"
              className="text-rose-600"
              onClick={async () => {
                await deleteExam(exam.id);
                onClose();
              }}
            >
              Delete
            </Button>
          )}
          <Button variant="secondary" className="ml-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid}>
            Save
          </Button>
        </div>
        {exam && <p className="text-xs text-slate-500">Last edited {formatDate(exam.updatedAt)}.</p>}
      </div>
    </Modal>
  );
}
