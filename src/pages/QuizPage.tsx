import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, Flag, Keyboard, NotebookPen, Timer, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { QuestionTools, NoteModal } from '../components/QuestionTools';
import { CONFIDENCE_LABEL, QuestionView } from '../components/QuestionView';
import { Button, cn, Kbd, Modal } from '../components/ui';
import { db, type Confidence, type QuizSession, type SessionAnswer, type StoredLecture, type StoredQuestion } from '../db';
import { formatDuration } from '../lib/dates';
import { recordAttempts, updateProgress } from '../lib/tracking';

const CONFIDENCES: { c: Confidence; key: string; tone: string }[] = [
  { c: 'sure', key: 'S', tone: 'bg-emerald-600 hover:bg-emerald-500 text-white' },
  { c: 'unsure', key: 'U', tone: 'bg-amber-500 hover:bg-amber-400 text-white' },
  { c: 'guess', key: 'G', tone: 'bg-slate-600 hover:bg-slate-500 text-white' },
];

interface Loaded {
  questions: Map<string, StoredQuestion>;
  lectures: Map<string, StoredLecture>;
}

export function QuizPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<QuizSession | null>(null);
  const [missing, setMissing] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [nudge, setNudge] = useState(false);
  const latest = useRef<QuizSession | null>(null);

  // Load the session once; after that this component owns it and persists changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await db.sessions.get(id!);
      if (cancelled) return;
      if (!s) return setMissing(true);
      if (s.finishedAt) return navigate(`/quiz/${s.id}/review`, { replace: true });
      setSession(s);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  const qids = session?.items.map((i) => i.qid).join('|') ?? '';
  // Questions are live so an in-app edit shows up immediately.
  const data = useLiveQuery(async (): Promise<Loaded | undefined> => {
    if (!qids) return undefined;
    const qs = await db.questions.bulkGet(qids.split('|'));
    const questions = new Map(qs.filter((q): q is StoredQuestion => !!q).map((q) => [q.qid, q]));
    const ls = await db.lectures.bulkGet([...new Set([...questions.values()].map((q) => q.lecture_id))]);
    return { questions, lectures: new Map(ls.filter((l): l is StoredLecture => !!l).map((l) => [l.lecture_id, l])) };
  }, [qids]);
  const progress = useLiveQuery(async () => {
    if (!qids) return new Map();
    const rows = await db.progress.bulkGet(qids.split('|'));
    return new Map(rows.filter((p) => !!p).map((p) => [p!.qid, p!]));
  }, [qids]);

  // Persist (debounced) and flush on leave.
  useEffect(() => {
    latest.current = session;
    if (!session) return;
    const t = setTimeout(() => void db.sessions.put(session), 400);
    return () => clearTimeout(t);
  }, [session]);
  useEffect(
    () => () => {
      if (latest.current) void db.sessions.put(latest.current);
    },
    [],
  );

  // Clock: total time, plus per-question time (until answered in tutor mode).
  const running = !!session && !session.finishedAt;
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const t = setInterval(() => {
      const now = performance.now();
      const delta = now - last;
      last = now;
      if (document.hidden) return;
      setSession((s) => {
        if (!s || s.finishedAt) return s;
        const a = s.answers[s.current];
        const counting = s.timed || !a.submitted;
        return {
          ...s,
          elapsedMs: s.elapsedMs + delta,
          answers: counting ? s.answers.map((x, i) => (i === s.current ? { ...x, timeMs: x.timeMs + delta } : x)) : s.answers,
        };
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running]);

  const patchAnswer = useCallback((i: number, patch: Partial<SessionAnswer>) => {
    setSession((s) => (s ? { ...s, answers: s.answers.map((a, j) => (j === i ? { ...a, ...patch } : a)) } : s));
  }, []);

  const finish = useCallback(async () => {
    const s = latest.current;
    if (!s || !data || s.finishedAt) return;
    const now = Date.now();
    let answers = s.answers;
    if (s.timed) {
      // Exam: grade everything now. Blank answers count against the score but
      // aren't recorded as attempts, so they stay "unseen" in your bank.
      answers = s.answers.map((a, i) => ({
        ...a,
        submitted: true,
        correct: a.chosen !== null && a.chosen === data.questions.get(s.items[i].qid)?.correct_option,
      }));
      await recordAttempts(
        answers.flatMap((a, i) =>
          a.chosen === null
            ? []
            : [{ qid: s.items[i].qid, ts: now, chosen: a.chosen, correct: !!a.correct, confidence: a.confidence, timeMs: Math.round(a.timeMs), mode: s.mode, sessionId: s.id }],
        ),
      );
    }
    const final = { ...s, answers, finishedAt: now };
    latest.current = final;
    await db.sessions.put(final);
    navigate(`/quiz/${s.id}/review`, { replace: true });
  }, [data, navigate]);

  // Exam time limit.
  useEffect(() => {
    if (session?.timed && session.timeLimitMs && !session.finishedAt && session.elapsedMs >= session.timeLimitMs) void finish();
  }, [session?.elapsedMs, session?.timed, session?.timeLimitMs, session?.finishedAt, finish]);

  const s = session;
  const i = s?.current ?? 0;
  const item = s?.items[i];
  const answer = s?.answers[i];
  const q = item ? data?.questions.get(item.qid) : undefined;
  const p = item ? progress?.get(item.qid) : undefined;
  const revealed = !!s && !s.timed && !!answer?.submitted;
  const isLast = !!s && i === s.items.length - 1;

  const select = useCallback(
    (optId: string) => {
      if (!s || !answer || revealed) return;
      patchAnswer(i, { chosen: optId, struck: answer.struck.filter((x) => x !== optId) });
    },
    [s, answer, revealed, i, patchAnswer],
  );

  const toggleStrike = useCallback(
    (optId: string) => {
      if (!answer || revealed) return;
      const struck = answer.struck.includes(optId) ? answer.struck.filter((x) => x !== optId) : [...answer.struck, optId];
      patchAnswer(i, { struck, chosen: answer.chosen === optId && !answer.struck.includes(optId) ? null : answer.chosen });
    },
    [answer, revealed, i, patchAnswer],
  );

  const confide = useCallback(
    (c: Confidence) => {
      if (!s || !answer || !q || !item) return;
      if (s.timed) {
        patchAnswer(i, { confidence: answer.confidence === c ? null : c });
        return;
      }
      if (answer.submitted) return;
      if (!answer.chosen) {
        setNudge(true);
        setTimeout(() => setNudge(false), 900);
        return;
      }
      const correct = answer.chosen === q.correct_option;
      patchAnswer(i, { confidence: c, submitted: true, correct });
      void recordAttempts([
        { qid: item.qid, ts: Date.now(), chosen: answer.chosen, correct, confidence: c, timeMs: Math.round(answer.timeMs), mode: s.mode, sessionId: s.id },
      ]);
    },
    [s, answer, q, item, i, patchAnswer],
  );

  const goto = useCallback((j: number) => setSession((x) => (x ? { ...x, current: Math.max(0, Math.min(x.items.length - 1, j)) } : x)), []);

  const next = useCallback(() => {
    if (!s) return;
    if (!s.timed && !answer?.submitted) return;
    if (!isLast) return goto(i + 1);
    const unanswered = s.answers.filter((a) => (s.timed ? a.chosen === null : !a.submitted)).length;
    if (s.timed || unanswered > 0) setEndOpen(true);
    else void finish();
  }, [s, answer, isLast, i, goto, finish]);

  const toggleFlag = useCallback(() => {
    if (item) void updateProgress(item.qid, { flagged: !p?.flagged });
  }, [item, p]);

  const openNote = useCallback(() => setNoteOpen(true), []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (noteOpen || endOpen || helpOpen || !s || !item) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const n = item.order.length;
      if (/^[1-9]$/.test(k) && Number(k) <= n) {
        select(item.order[Number(k) - 1]);
      } else if (/^[a-e]$/.test(k) && k.charCodeAt(0) - 97 < n) {
        select(item.order[k.charCodeAt(0) - 97]);
      } else if (k === 's') confide('sure');
      else if (k === 'u') confide('unsure');
      else if (k === 'g') confide('guess');
      else if (k === 'enter') {
        // A focused toolbar button handles Enter itself; a focused answer choice shouldn't swallow it.
        if (t.tagName === 'BUTTON' && t.getAttribute('role') !== 'radio') return;
        next();
      } else if (k === 'f') toggleFlag();
      else if (k === 'n') openNote();
      else if (k === 'arrowright' && (s.timed || answer?.submitted)) next();
      else if (k === 'arrowleft') goto(i - 1);
      else if (k === '?') setHelpOpen(true);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [noteOpen, endOpen, helpOpen, s, item, answer, i, select, confide, next, toggleFlag, openNote, goto]);

  if (missing) {
    return (
      <div className="py-16 text-center">
        <p className="mb-4">That quiz doesn't exist anymore.</p>
        <Button onClick={() => navigate('/')}>Home</Button>
      </div>
    );
  }
  if (!s || !data || !item || !answer) return null;

  const answeredCount = s.answers.filter((a) => (s.timed ? a.chosen !== null : a.submitted)).length;
  const remaining = s.timeLimitMs ? Math.max(0, s.timeLimitMs - s.elapsedMs) : null;
  const unanswered = s.items.length - answeredCount;

  return (
    <div className="mx-auto max-w-3xl pb-40 sm:pb-8">
      {/* Header */}
      <div className="sticky top-14 z-20 -mx-4 mb-5 border-b border-slate-200 bg-slate-50/95 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tabular-nums">
            {i + 1} / {s.items.length}
          </span>
          <span className="hidden truncate text-sm text-slate-500 sm:inline">· {s.title}</span>
          <span
            className={cn(
              'ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm tabular-nums',
              remaining !== null && remaining < 5 * 60_000 ? 'bg-rose-100 font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-300' : 'text-slate-600 dark:text-slate-400',
            )}
            title={remaining !== null ? 'Time remaining in block' : 'Time elapsed'}
          >
            <Timer className="h-4 w-4" />
            {formatDuration(remaining ?? s.elapsedMs)}
          </span>
          <button
            type="button"
            onClick={toggleFlag}
            title="Flag (F)"
            aria-pressed={!!p?.flagged}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm',
              p?.flagged ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800',
            )}
          >
            <Flag className={cn('h-4 w-4', p?.flagged && 'fill-current')} />
            <span className="hidden sm:inline">{p?.flagged ? 'Flagged' : 'Flag'}</span>
          </button>
          <button
            type="button"
            onClick={openNote}
            title="Note (N)"
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm',
              p?.note ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-600 dark:text-slate-400',
              'hover:bg-slate-200 dark:hover:bg-slate-800',
            )}
          >
            <NotebookPen className="h-4 w-4" />
            <span className="hidden sm:inline">Note</span>
          </button>
          <button type="button" onClick={() => setHelpOpen(true)} title="Keyboard shortcuts (?)" className="hidden rounded-md p-1 text-slate-500 hover:bg-slate-200 sm:block dark:hover:bg-slate-800">
            <Keyboard className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setEndOpen(true)} className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800">
            {s.timed ? 'End block' : 'End'}
          </button>
        </div>
        <div className="mt-2 flex gap-0.5">
          {s.answers.map((a, j) => (
            <button
              key={j}
              type="button"
              aria-label={`Go to question ${j + 1}`}
              onClick={() => goto(j)}
              className={cn(
                'h-1.5 flex-1 rounded-full',
                j === i && 'ring-2 ring-indigo-500 ring-offset-1 ring-offset-slate-50 dark:ring-offset-slate-950',
                s.timed
                  ? a.chosen !== null
                    ? 'bg-indigo-500'
                    : 'bg-slate-300 dark:bg-slate-700'
                  : a.submitted
                    ? a.correct
                      ? 'bg-emerald-500'
                      : 'bg-rose-500'
                    : 'bg-slate-300 dark:bg-slate-700',
              )}
            />
          ))}
        </div>
      </div>

      {p?.note && (
        <button type="button" onClick={openNote} className="mb-4 block w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-left text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
          <span className="font-semibold">Your note:</span> {p.note}
        </button>
      )}

      {q ? (
        <QuestionView
          question={q}
          lecture={data.lectures.get(q.lecture_id)}
          order={item.order}
          answer={answer}
          revealed={revealed}
          interactive={!revealed}
          onSelect={select}
          onToggleStrike={toggleStrike}
          footer={<QuestionTools question={q} tools={['edit', 'report']} />}
          scrollOnReveal
        />
      ) : (
        <p className="rounded-lg bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          This question was removed from your bank. <Button variant="ghost" onClick={() => goto(i + 1)}>Skip</Button>
        </p>
      )}

      {!revealed && (
        <p className="mt-3 hidden text-xs text-slate-500 sm:block">
          Right-click an answer to cross it out. <Kbd>1</Kbd>–<Kbd>5</Kbd> or <Kbd>A</Kbd>–<Kbd>E</Kbd> to select · <Kbd>?</Kbd> for all shortcuts
        </p>
      )}

      {/* Action bar: fixed on phones, inline on larger screens */}
      <div className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur sm:static sm:mt-6 sm:border-0 sm:bg-transparent sm:backdrop-blur-none dark:border-slate-800 dark:bg-slate-950/95 sm:dark:bg-transparent">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-4 py-3 sm:px-0">
          {s.timed ? (
            <>
              <Button variant="secondary" onClick={() => goto(i - 1)} disabled={i === 0} aria-label="Previous">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex flex-1 items-center justify-center gap-1.5">
                <span className="hidden text-xs text-slate-500 sm:inline">Confidence (optional):</span>
                {CONFIDENCES.map(({ c, key }) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => confide(c)}
                    aria-pressed={answer.confidence === c}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-sm ring-1 ring-inset',
                      answer.confidence === c ? 'bg-indigo-600 text-white ring-indigo-600' : 'ring-slate-300 dark:ring-slate-700',
                    )}
                  >
                    {CONFIDENCE_LABEL[c]} <span className="hidden opacity-60 sm:inline">({key})</span>
                  </button>
                ))}
              </div>
              <Button onClick={next}>
                {isLast ? 'Review & end' : 'Next'} <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          ) : !answer.submitted ? (
            <>
              {i > 0 && (
                <Button variant="ghost" onClick={() => goto(i - 1)} aria-label="Previous question">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              )}
              <span className={cn('flex-1 text-sm transition-colors', nudge ? 'font-semibold text-rose-600' : 'text-slate-600 dark:text-slate-400')}>
                {answer.chosen ? 'How sure are you?' : 'Select an answer'}
              </span>
              {answer.chosen && (
                <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto">
                  {CONFIDENCES.map(({ c, key, tone }) => (
                    <button key={c} type="button" onClick={() => confide(c)} className={cn('rounded-lg px-4 py-3 text-sm font-semibold shadow-sm sm:py-2.5', tone)}>
                      {CONFIDENCE_LABEL[c]} <span className="hidden font-normal opacity-75 sm:inline">({key})</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {i > 0 && (
                <Button variant="ghost" onClick={() => goto(i - 1)} aria-label="Previous question">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              )}
              <Button size="lg" className="ml-auto w-full sm:w-auto" onClick={next}>
                {isLast ? 'Finish quiz' : 'Next question'} <span className="hidden font-normal opacity-75 sm:inline">(Enter)</span>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {s.timed && (
        <div className="mt-6 hidden sm:block">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Questions</div>
          <div className="flex flex-wrap gap-1.5">
            {s.items.map((it, j) => (
              <button
                key={j}
                type="button"
                onClick={() => goto(j)}
                className={cn(
                  'relative h-9 w-9 rounded-md text-sm tabular-nums ring-1 ring-inset',
                  j === i ? 'ring-2 ring-indigo-500' : 'ring-slate-300 dark:ring-slate-700',
                  s.answers[j].chosen !== null ? 'bg-indigo-50 font-semibold dark:bg-indigo-950/50' : 'bg-white dark:bg-slate-900',
                )}
              >
                {j + 1}
                {progress?.get(it.qid)?.flagged && <Flag className="absolute -right-1 -top-1 h-3 w-3 fill-amber-500 text-amber-500" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {noteOpen && <NoteModal qid={item.qid} initial={p?.note ?? ''} onClose={() => setNoteOpen(false)} />}

      <Modal open={endOpen} onClose={() => setEndOpen(false)} title={s.timed ? 'End this block?' : 'Finish this quiz?'}>
        <p className="text-slate-700 dark:text-slate-300">
          {unanswered > 0
            ? `${unanswered} question${unanswered === 1 ? ' is' : 's are'} unanswered. ${s.timed ? "They'll count as incorrect in this block's score but stay unseen in your bank." : "They won't be recorded."}`
            : 'All questions answered.'}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEndOpen(false)}>
            Keep going
          </Button>
          <Button
            onClick={() => {
              setEndOpen(false);
              void finish();
            }}
          >
            {s.timed ? 'End block & see results' : 'Finish & review'}
          </Button>
        </div>
      </Modal>

      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="Keyboard shortcuts">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt><Kbd>1</Kbd>–<Kbd>5</Kbd> / <Kbd>A</Kbd>–<Kbd>E</Kbd></dt><dd>Select an answer</dd>
          <dt><Kbd>S</Kbd> <Kbd>U</Kbd> <Kbd>G</Kbd></dt><dd>Sure / Unsure / Guess {s.timed ? '(optional in exam mode)' : '— submits your answer'}</dd>
          <dt><Kbd>Enter</Kbd> / <Kbd>→</Kbd></dt><dd>Next question</dd>
          <dt><Kbd>←</Kbd></dt><dd>Previous question</dd>
          <dt><Kbd>F</Kbd></dt><dd>Flag / unflag</dd>
          <dt><Kbd>N</Kbd></dt><dd>Add a note</dd>
          <dt>Right-click / long-press</dt><dd>Cross out an answer</dd>
        </dl>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setHelpOpen(false)}>
            <X className="h-4 w-4" /> Close
          </Button>
        </div>
      </Modal>
    </div>
  );
}
