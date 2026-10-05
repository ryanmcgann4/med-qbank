import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, Flag, Home, RotateCcw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { QuestionTools } from '../components/QuestionTools';
import { CONFIDENCE_LABEL, QuestionView } from '../components/QuestionView';
import { Badge, Button, Card, Chip, cn, PageHeader, pct, Stat } from '../components/ui';
import { db, type Confidence, type QuizSession, type StoredLecture, type StoredQuestion } from '../db';
import { formatDate, formatDuration } from '../lib/dates';
import { defaultConfig, letter, MODE_LABELS } from '../lib/selection';
import { createQuiz } from '../lib/tracking';

/**
 * Exam blocks are scored NBME-style (blanks count against you). Tutor quizzes
 * ended early are scored on what you actually answered.
 */
export function sessionScore(s: QuizSession) {
  const correct = s.answers.filter((a) => a.correct === true).length;
  const answered = s.answers.filter((a) => a.chosen !== null && a.submitted).length;
  const total = s.items.length;
  return { correct, answered, total, outOf: s.timed ? total : answered };
}

const isBlank = (a: QuizSession['answers'][number]) => a.chosen === null || !a.submitted;

type Filter = 'all' | 'missed' | 'flagged' | 'guessed';

export function QuizReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Set<number>>(new Set());

  const data = useLiveQuery(async () => {
    const s = await db.sessions.get(id!);
    if (!s) return { s: null };
    const qids = s.items.map((i) => i.qid);
    const [qs, ps] = await Promise.all([db.questions.bulkGet(qids), db.progress.bulkGet(qids)]);
    const questions = new Map(qs.filter((q): q is StoredQuestion => !!q).map((q) => [q.qid, q]));
    const ls = await db.lectures.bulkGet([...new Set([...questions.values()].map((q) => q.lecture_id))]);
    const lectures = new Map(ls.filter((l): l is StoredLecture => !!l).map((l) => [l.lecture_id, l]));
    const flagged = new Set(ps.filter((p) => p?.flagged).map((p) => p!.qid));
    return { s, questions, lectures, flagged };
  }, [id]);

  if (!data) return null;
  if (!data.s) {
    return (
      <div className="py-16 text-center">
        <p className="mb-4">That quiz doesn't exist anymore.</p>
        <Button onClick={() => navigate('/')}>Home</Button>
      </div>
    );
  }
  const { s, questions, lectures, flagged } = data;
  if (!s.finishedAt) return <Navigate to={`/quiz/${s.id}`} replace />;

  const { correct, answered, total, outOf } = sessionScore(s);
  const blankIdx = s.answers.flatMap((a, i) => (isBlank(a) ? [i] : []));
  const missedIdx = s.answers.flatMap((a, i) => (a.correct || (!s.timed && isBlank(a)) ? [] : [i]));
  const guessedIdx = s.answers.flatMap((a, i) => (a.confidence === 'guess' || a.confidence === 'unsure' ? [i] : []));
  const timeOnQuestions = s.answers.reduce((n, a) => n + a.timeMs, 0);

  const calib = (['sure', 'unsure', 'guess'] as Confidence[]).map((c) => {
    const xs = s.answers.filter((a) => a.confidence === c && a.submitted && a.chosen !== null);
    return { c, n: xs.length, right: xs.filter((a) => a.correct).length };
  });

  const shown = s.items
    .map((item, i) => ({ item, i, a: s.answers[i] }))
    .filter(({ item, i }) => {
      if (filter === 'missed') return missedIdx.includes(i);
      if (filter === 'flagged') return flagged?.has(item.qid);
      if (filter === 'guessed') return guessedIdx.includes(i);
      return true;
    });

  async function requiz(indices: number[], title: string) {
    const qids = [...new Set(indices.map((i) => s.items[i].qid))];
    const next = await createQuiz({ ...defaultConfig(), mode: 'custom', qids, count: qids.length, includeRecentCorrect: true }, title);
    if (next) navigate(`/quiz/${next.id}`);
  }

  const missOrShaky = [...new Set([...missedIdx, ...s.answers.flatMap((a, i) => (a.confidence === 'guess' ? [i] : []))])];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={s.title}
        subtitle={`${MODE_LABELS[s.mode]} · finished ${formatDate(s.finishedAt)}`}
        actions={
          <Button variant="ghost" onClick={() => navigate('/')}>
            <Home className="h-4 w-4" /> Home
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Score" value={pct(outOf ? correct / outOf : null)} sub={`${correct} of ${outOf} correct`} tone="indigo" />
        <Stat label="Answered" value={`${answered}/${total}`} sub={total - answered ? `${total - answered} left blank` : 'all answered'} />
        <Stat label="Total time" value={formatDuration(s.elapsedMs)} sub={s.timeLimitMs ? `of ${formatDuration(s.timeLimitMs)}` : undefined} />
        <Stat label="Per question" value={formatDuration(answered ? timeOnQuestions / answered : 0)} sub="average to answer" />
      </div>

      {calib.some((x) => x.n) && (
        <Card className="mt-3 p-4">
          <div className="mb-2 text-sm font-semibold">Confidence check</div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            {calib.map(({ c, n, right }) => (
              <div key={c}>
                <div className="text-slate-600 dark:text-slate-400">{CONFIDENCE_LABEL[c]}</div>
                <div className="text-lg font-semibold tabular-nums">{n ? pct(right / n) : '—'}</div>
                <div className="text-xs text-slate-500">
                  {right}/{n} correct
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={() => requiz(missedIdx, `Redemption · ${s.title}`)} disabled={!missedIdx.length}>
          <RotateCcw className="h-4 w-4" /> Re-quiz my misses ({missedIdx.length})
        </Button>
        {!s.timed && blankIdx.length > 0 && (
          <Button variant="secondary" onClick={() => requiz(blankIdx, `Unfinished · ${s.title}`)}>
            Finish the {blankIdx.length} unanswered
          </Button>
        )}
        {missOrShaky.length > missedIdx.length && (
          <Button variant="secondary" onClick={() => requiz(missOrShaky, `Misses + guesses · ${s.title}`)}>
            Misses + lucky guesses ({missOrShaky.length})
          </Button>
        )}
        <Button variant="secondary" onClick={() => navigate('/quiz/new')}>
          <Sparkles className="h-4 w-4" /> New quiz
        </Button>
      </div>

      <div className="mb-3 mt-8 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-base font-semibold">Questions</h2>
        <Chip selected={filter === 'all'} onClick={() => setFilter('all')} count={total}>
          All
        </Chip>
        <Chip selected={filter === 'missed'} onClick={() => setFilter('missed')} count={missedIdx.length}>
          Missed
        </Chip>
        <Chip selected={filter === 'guessed'} onClick={() => setFilter('guessed')} count={guessedIdx.length}>
          Unsure / guessed
        </Chip>
        <Chip selected={filter === 'flagged'} onClick={() => setFilter('flagged')} count={s.items.filter((it) => flagged?.has(it.qid)).length}>
          Flagged
        </Chip>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => setOpen(open.size ? new Set() : new Set(shown.map((x) => x.i)))}
        >
          {open.size ? 'Collapse all' : 'Expand all'}
        </Button>
      </div>

      <div className="space-y-2">
        {shown.map(({ item, i, a }) => {
          const q = questions?.get(item.qid);
          const isOpen = open.has(i);
          const correctL = q ? letter(item.order.indexOf(q.correct_option)) : '?';
          const chosenL = a.chosen ? letter(item.order.indexOf(a.chosen)) : null;
          return (
            <Card key={i} className={cn(isOpen && 'ring-1 ring-indigo-300 dark:ring-indigo-800')}>
              <button
                type="button"
                onClick={() => setOpen((o) => new Set(o.has(i) ? [...o].filter((x) => x !== i) : [...o, i]))}
                className="flex w-full items-start gap-3 p-4 text-left"
                aria-expanded={isOpen}
              >
                <span className="w-7 shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-slate-500">{i + 1}.</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {a.correct ? <Badge tone="green">✓ Correct</Badge> : chosenL ? <Badge tone="red">✗ Incorrect</Badge> : <Badge>— Blank</Badge>}
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {chosenL ? `You: ${chosenL}` : 'No answer'} · Answer: {correctL}
                      {a.confidence && ` · ${CONFIDENCE_LABEL[a.confidence]}`}
                    </span>
                    {flagged?.has(item.qid) && <Flag className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-sm">{q?.stem ?? 'Question removed from bank'}</span>
                  {q && <span className="mt-0.5 block text-xs text-slate-500">{lectures?.get(q.lecture_id)?.title}</span>}
                </span>
                <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform', isOpen && 'rotate-180')} />
              </button>
              {isOpen && q && (
                <div className="border-t border-slate-100 p-4 dark:border-slate-800">
                  <QuestionView
                    question={q}
                    lecture={lectures?.get(q.lecture_id)}
                    order={item.order}
                    answer={a}
                    revealed
                    interactive={false}
                    footer={<QuestionTools question={q} />}
                  />
                </div>
              )}
            </Card>
          );
        })}
        {shown.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Nothing here.</p>}
      </div>
    </div>
  );
}
