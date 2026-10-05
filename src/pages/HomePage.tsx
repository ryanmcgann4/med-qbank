import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, CalendarClock, Flag, PlayCircle, PlusCircle, RotateCcw, Sparkles, Target } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Badge, Button, Card, PageHeader, pct, Stat } from '../components/ui';
import { db, type QuizConfig, type StatusKey } from '../db';
import { formatDate } from '../lib/dates';
import { defaultConfig, MODE_LABELS } from '../lib/selection';
import { hasStatus } from '../lib/status';
import { createQuiz } from '../lib/tracking';
import { useCandidates } from '../hooks/useBank';
import { sessionScore } from './QuizReviewPage';
import { ExamCards } from '../components/ExamCard';

export function HomePage() {
  const navigate = useNavigate();
  const cands = useCandidates();
  const sessions = useLiveQuery(() => db.sessions.orderBy('createdAt').reverse().limit(30).toArray(), []);
  const imports = useLiveQuery(() => db.imports.orderBy('importedAt').reverse().limit(5).toArray(), []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!cands) return null;

  const now = Date.now();
  const count = (k: StatusKey) => cands.filter((c) => hasStatus(c.progress, k, now)).length;
  const due = count('due');
  const unseen = count('unseen');
  const missed = count('missed');
  const flagged = count('flagged');
  const seen = cands.length - unseen;
  const attempts = cands.reduce((n, c) => n + (c.progress?.timesSeen ?? 0), 0);
  const correct = cands.reduce((n, c) => n + (c.progress?.timesCorrect ?? 0), 0);
  const unfinished = sessions?.find((s) => !s.finishedAt);
  const recent = sessions?.filter((s) => s.finishedAt).slice(0, 5) ?? [];

  async function start(over: Partial<QuizConfig>, title?: string) {
    setBusy(true);
    setMsg(null);
    const s = await createQuiz({ ...defaultConfig(), ...over }, title);
    setBusy(false);
    if (s) navigate(`/quiz/${s.id}`);
    else setMsg('No questions match — they may all have been answered correctly in the last few days.');
  }

  if (cands.length === 0) {
    return (
      <div className="mx-auto max-w-xl py-10 text-center">
        <img src="./favicon.svg" alt="" className="mx-auto mb-4 h-14 w-14" />
        <h1 className="text-2xl font-semibold tracking-tight">Your question bank is empty</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          Each lecture day, generate questions in Claude with the built-in prompt and drop the JSON file in. Everything stays on this device.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button size="lg" onClick={() => navigate('/add')}>
            <PlusCircle className="h-5 w-5" /> Add questions
          </Button>
          <Button size="lg" variant="secondary" onClick={() => navigate('/add?sample=1')}>
            <Sparkles className="h-5 w-5" /> Load 10 sample questions
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Today" subtitle={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} />

      {unfinished && (
        <Card className="mb-6 flex flex-wrap items-center gap-3 border-indigo-200 p-4 dark:border-indigo-900">
          <PlayCircle className="h-6 w-6 text-indigo-600" />
          <div className="flex-1">
            <div className="font-medium">Resume: {unfinished.title}</div>
            <div className="text-sm text-slate-600 dark:text-slate-400">
              {unfinished.answers.filter((a) => a.submitted || a.chosen).length} of {unfinished.items.length} answered · started{' '}
              {formatDate(unfinished.createdAt)}
            </div>
          </div>
          <Button onClick={() => navigate(`/quiz/${unfinished.id}`)}>Resume</Button>
        </Card>
      )}

      <ExamCards cands={cands} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Due today" value={due} tone="indigo" sub={due ? 'spaced-repetition reviews' : 'nothing due — nice'} />
        <Stat label="Questions in bank" value={cands.length} sub={`${seen} seen · ${unseen} unseen`} />
        <Stat label="Overall accuracy" value={pct(attempts ? correct / attempts : null)} sub={`${attempts} answers`} />
        <Stat label="Missed last time" value={missed} sub={`${flagged} flagged`} />
      </div>

      <h2 className="mb-3 mt-8 text-base font-semibold">Start a quiz</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <QuickStart
          icon={<Sparkles className="h-5 w-5" />}
          title="Smart mix · 20"
          desc="Due reviews first, then misses, then new questions."
          onClick={() => start({ mode: 'smart', count: 20 })}
          disabled={busy}
          primary
        />
        <QuickStart
          icon={<CalendarClock className="h-5 w-5" />}
          title={`Review due (${due})`}
          desc="Everything the scheduler wants back today."
          onClick={() => start({ mode: 'smart', count: Math.min(due, 100), filters: { ...defaultConfig().filters, statuses: ['due'] } }, 'Due reviews')}
          disabled={busy || !due}
        />
        <QuickStart
          icon={<Target className="h-5 w-5" />}
          title={`Unseen (${unseen})`}
          desc="Only questions you haven't answered yet."
          onClick={() => start({ mode: 'unseen', count: 20 })}
          disabled={busy || !unseen}
        />
        <QuickStart
          icon={<RotateCcw className="h-5 w-5" />}
          title={`Redemption run (${missed})`}
          desc="Questions you got wrong last time."
          onClick={() => start({ mode: 'missed', count: Math.min(missed, 50), includeRecentCorrect: true })}
          disabled={busy || !missed}
        />
        <QuickStart
          icon={<Flag className="h-5 w-5" />}
          title={`Flagged (${flagged})`}
          desc="Questions you flagged to revisit."
          onClick={() =>
            start({ mode: 'smart', count: Math.min(flagged, 100), includeRecentCorrect: true, filters: { ...defaultConfig().filters, statuses: ['flagged'] } }, 'Flagged')
          }
          disabled={busy || !flagged}
        />
        <QuickStart
          icon={<ArrowRight className="h-5 w-5" />}
          title="Custom quiz…"
          desc="Pick lectures, weeks, tags, exam mode."
          onClick={() => navigate('/quiz/new')}
        />
      </div>
      {msg && <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">{msg}</p>}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-base font-semibold">Recent quizzes</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">No finished quizzes yet.</p>
          ) : (
            <Card className="divide-y divide-slate-100 dark:divide-slate-800">
              {recent.map((s) => {
                const { correct, outOf } = sessionScore(s);
                return (
                  <Link key={s.id} to={`/quiz/${s.id}/review`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{s.title}</div>
                      <div className="text-sm text-slate-500">
                        {formatDate(s.finishedAt)} · {MODE_LABELS[s.mode]}
                      </div>
                    </div>
                    <Badge tone={outOf && correct / outOf >= 0.7 ? 'green' : 'amber'}>
                      {correct}/{outOf} · {pct(outOf ? correct / outOf : null)}
                    </Badge>
                  </Link>
                );
              })}
            </Card>
          )}
        </div>
        <div>
          <h2 className="mb-3 text-base font-semibold">Recent imports</h2>
          {!imports?.length ? (
            <p className="text-sm text-slate-500">Nothing imported yet.</p>
          ) : (
            <Card className="divide-y divide-slate-100 dark:divide-slate-800">
              {imports.map((im) => (
                <div key={im.id} className="px-4 py-3">
                  <div className="font-medium">{im.files.map((f) => f.day_label).join(', ') || 'Import'}</div>
                  <div className="text-sm text-slate-500">
                    {formatDate(im.importedAt)} · {im.added} new
                    {im.overwritten ? ` · ${im.overwritten} updated` : ''}
                    {im.invalid ? ` · ${im.invalid} invalid` : ''}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function QuickStart({
  icon,
  title,
  desc,
  onClick,
  disabled,
  primary,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ' +
        (primary
          ? 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-500'
          : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/30')
      }
    >
      <span className={primary ? 'text-indigo-100' : 'text-indigo-600 dark:text-indigo-400'}>{icon}</span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className={'mt-0.5 block text-sm ' + (primary ? 'text-indigo-100' : 'text-slate-600 dark:text-slate-400')}>{desc}</span>
      </span>
    </button>
  );
}
