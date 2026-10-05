import { useLiveQuery } from 'dexie-react-hooks';
import { PlayCircle } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CONFIDENCE_LABEL } from '../components/QuestionView';
import { Button, Card, Chip, cn, PageHeader, pct, SectionTitle, Stat } from '../components/ui';
import { db } from '../db';
import { useCandidates } from '../hooks/useBank';
import { useStartQuiz } from '../hooks/useStartQuiz';
import { formatDate } from '../lib/dates';
import { emptyFilters } from '../lib/selection';
import { byLecture, byTag, byWeek, calibration, dailyTrend, statusCounts, streakDays, weakest, type Agg } from '../lib/stats';

const RANGES = [30, 90, 365] as const;
const axisTick = { fill: 'var(--chart-axis)', fontSize: 12 };

export default function StatsPage() {
  const cands = useCandidates();
  const attempts = useLiveQuery(() => db.attempts.toArray(), []);
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const [now] = useState(() => Date.now());
  const { start, busy, message } = useStartQuiz();

  const derived = useMemo(() => {
    if (!cands || !attempts) return null;
    const lectures = byLecture(cands);
    const tags = byTag(cands);
    return {
      lectures,
      tags,
      weeks: byWeek(cands),
      weakLectures: weakest(lectures),
      weakTags: weakest(tags),
      calib: calibration(attempts),
      status: statusCounts(cands, now),
      streak: streakDays(attempts, now),
    };
  }, [cands, attempts, now]);
  const trend = useMemo(() => (attempts ? dailyTrend(attempts, range, now) : []), [attempts, range, now]);

  if (!cands || !attempts || !derived) return null;
  if (!attempts.length) {
    return (
      <div>
        <PageHeader title="Stats" />
        <Card className="p-8 text-center text-slate-600 dark:text-slate-400">
          Answer some questions and your accuracy, weak spots, and calibration show up here.{' '}
          <Link to="/quiz/new" className="text-indigo-600 underline dark:text-indigo-400">
            Start a quiz
          </Link>
        </Card>
      </div>
    );
  }

  const { status } = derived;
  const seen = cands.length - status.unseen;
  const totalCorrect = attempts.filter((a) => a.correct).length;
  const learning = seen - status.mastered;

  return (
    <div className="space-y-6">
      <PageHeader title="Stats" subtitle={`${attempts.length} answers since ${formatDate(Math.min(...attempts.map((a) => a.ts)))}`} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Questions in bank" value={cands.length} />
        <Stat label="Seen" value={seen} sub={`${status.unseen} unseen`} />
        <Stat label="Overall accuracy" value={pct(totalCorrect / attempts.length)} sub={`${totalCorrect} of ${attempts.length}`} />
        <Stat label="Due today" value={status.due} tone="indigo" />
        <Stat label="Mastered" value={status.mastered} sub="box 4+" />
        <Stat label="Study streak" value={`${derived.streak} day${derived.streak === 1 ? '' : 's'}`} />
      </div>

      <Card className="p-5">
        <SectionTitle hint="Mastered = three spaced, confident correct answers in a row.">Where your bank stands</SectionTitle>
        <StatusBar
          parts={[
            { label: 'Mastered', n: status.mastered, color: 'var(--series-2)' },
            { label: 'Learning', n: learning, color: 'var(--series-1)' },
            { label: 'Unseen', n: status.unseen, color: 'var(--series-muted)' },
          ]}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <WeakList
          title="Weakest lectures"
          items={derived.weakLectures}
          busy={busy}
          empty="Answer at least 3 questions in a lecture to rank it."
          onQuiz={() => start({ mode: 'smart', count: 20, filters: { ...emptyFilters(), lectures: derived.weakLectures.map((a) => a.key) } }, 'Weak lectures')}
          link={(a) => `/library/${encodeURIComponent(a.key)}`}
        />
        <WeakList
          title="Weakest topics (tags)"
          items={derived.weakTags}
          busy={busy}
          empty="Answer at least 3 questions with a tag to rank it."
          onQuiz={() => start({ mode: 'smart', count: 20, filters: { ...emptyFilters(), tags: derived.weakTags.map((a) => a.key) } }, 'Weak topics')}
        />
      </div>
      {message && <p className="text-sm text-amber-700 dark:text-amber-400">{message}</p>}

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SectionTitle>Accuracy over time</SectionTitle>
          <div className="ml-auto flex gap-1.5">
            {RANGES.map((r) => (
              <Chip key={r} selected={range === r} onClick={() => setRange(r)}>
                {r === 365 ? '1 year' : `${r} days`}
              </Chip>
            ))}
          </div>
        </div>
        <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">7-day rolling accuracy</p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--chart-baseline)' }} tickFormatter={shortDate} minTickGap={24} />
              <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={axisTick} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1 }}
                content={({ active, payload }) => {
                  const d = active && payload?.[0]?.payload;
                  if (!d) return null;
                  return (
                    <TooltipBox title={formatDate(d.date)}>
                      <TooltipRow color="var(--series-1)" value={pct(d.rolling)} label="7-day accuracy" />
                      <div className="mt-1 text-xs text-slate-500">
                        That day: {d.n ? `${d.correct}/${d.n} correct` : 'no answers'}
                      </div>
                    </TooltipBox>
                  );
                }}
              />
              <Line type="monotone" dataKey="rolling" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--chart-surface)' }} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mb-2 mt-5 text-sm text-slate-600 dark:text-slate-400">Questions answered per day</p>
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend} margin={{ top: 4, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--chart-baseline)' }} tickFormatter={shortDate} minTickGap={24} />
              <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} width={40} />
              <Tooltip
                cursor={{ fill: 'var(--chart-grid)' }}
                content={({ active, payload }) => {
                  const d = active && payload?.[0]?.payload;
                  if (!d) return null;
                  return (
                    <TooltipBox title={formatDate(d.date)}>
                      <TooltipRow color="var(--series-1)" value={String(d.n)} label="answered" />
                    </TooltipBox>
                  );
                }}
              />
              <Bar dataKey="n" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <TableView
          head={['Date', 'Answered', 'Correct', 'Accuracy', '7-day']}
          rows={trend.filter((d) => d.n).reverse().map((d) => [formatDate(d.date), d.n, d.correct, pct(d.accuracy), pct(d.rolling)])}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle hint="Are you right when you feel sure? With 5 options, guessing blindly scores about 20%.">Calibration</SectionTitle>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={derived.calib.map((c) => ({ ...c, name: CONFIDENCE_LABEL[c.confidence], acc: c.accuracy ?? 0 }))} margin={{ top: 20, right: 48, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--chart-baseline)' }} />
                <YAxis domain={[0, 1]} ticks={[0, 0.5, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={axisTick} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: 'var(--chart-grid)' }}
                  content={({ active, payload }) => {
                    const d = active && payload?.[0]?.payload;
                    if (!d) return null;
                    return (
                      <TooltipBox title={d.name}>
                        <TooltipRow color="var(--series-1)" value={pct(d.accuracy)} label={`${d.correct} of ${d.n} correct`} />
                      </TooltipBox>
                    );
                  }}
                />
                <Bar dataKey="acc" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false}>
                  <LabelList
                    dataKey="accuracy"
                    position="top"
                    formatter={(v: unknown) => (typeof v === 'number' ? pct(v) : '—')}
                    style={{ fill: 'currentColor', fontSize: 12, fontWeight: 600 }}
                  />
                </Bar>
                <ReferenceLine y={0.2} stroke="var(--chart-axis)" strokeWidth={1} label={{ value: 'chance', position: 'right', fill: 'var(--chart-axis)', fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {derived.calib.map((c) => `${CONFIDENCE_LABEL[c.confidence]}: ${c.n} answers`).join(' · ')}
          </p>
        </Card>

        <Card className="p-5">
          <SectionTitle hint="Answer-weighted accuracy for each week of lectures.">Accuracy by week</SectionTitle>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={derived.weeks.map((w) => ({ ...w, acc: w.accuracy ?? 0 }))} margin={{ top: 20, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--chart-baseline)' }} />
                <YAxis domain={[0, 1]} ticks={[0, 0.5, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={axisTick} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: 'var(--chart-grid)' }}
                  content={({ active, payload }) => {
                    const d = active && (payload?.[0]?.payload as Agg | undefined);
                    if (!d) return null;
                    return (
                      <TooltipBox title={`${d.sub} · ${d.label}`}>
                        <TooltipRow color="var(--series-1)" value={pct(d.accuracy)} label={`${d.correct}/${d.attempts} answers · ${d.seenQuestions}/${d.questions} questions seen`} />
                      </TooltipBox>
                    );
                  }}
                />
                <Bar dataKey="acc" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
                  {derived.weeks.map((w) => (
                    <Cell key={w.key} fill={w.accuracy === null ? 'var(--series-muted)' : 'var(--series-1)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <TableView head={['Week', 'Questions', 'Seen', 'Accuracy']} rows={derived.weeks.map((w) => [`${w.sub} · ${w.label}`, w.questions, w.seenQuestions, pct(w.accuracy)])} />
        </Card>
      </div>

      <AggTable title="By lecture" rows={derived.lectures} link={(a) => `/library/${encodeURIComponent(a.key)}`} />
      <AggTable title="By tag" rows={derived.tags} />
    </div>
  );
}

const shortDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function TooltipBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-1 text-xs text-slate-500 dark:text-slate-400">{title}</div>
      {children}
    </div>
  );
}

function TooltipRow({ color, value, label }: { color: string; value: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-0.5 w-3 rounded-full" style={{ background: color }} />
      <span className="font-semibold text-slate-900 dark:text-white">{value}</span>
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
    </div>
  );
}

function TableView({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">Table view</summary>
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-white text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
            <tr>
              {head.map((h, i) => (
                <th key={h} className={cn('py-1.5 font-medium', i > 0 && 'text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                {r.map((c, j) => (
                  <td key={j} className={cn('py-1.5', j > 0 && 'text-right')}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function StatusBar({ parts }: { parts: { label: string; n: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.n, 0) || 1;
  return (
    <div>
      <div className="flex h-4 gap-0.5 overflow-hidden rounded" role="img" aria-label={parts.map((p) => `${p.label} ${p.n}`).join(', ')}>
        {parts
          .filter((p) => p.n > 0)
          .map((p) => (
            <div key={p.label} title={`${p.label}: ${p.n}`} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} />
          ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: p.color }} />
            <span className="text-slate-600 dark:text-slate-400">{p.label}</span>
            <span className="font-semibold">{p.n}</span>
            <span className="text-slate-500">({pct(p.n / total)})</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Meter({ value }: { value: number | null }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--series-1)_18%,transparent)]" aria-hidden>
      <div className="h-full rounded-full bg-[var(--series-1)]" style={{ width: `${(value ?? 0) * 100}%` }} />
    </div>
  );
}

function WeakList({
  title,
  items,
  onQuiz,
  busy,
  empty,
  link,
}: {
  title: string;
  items: Agg[];
  onQuiz: () => void;
  busy: boolean;
  empty: string;
  link?: (a: Agg) => string;
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {items.length > 0 && (
          <Button size="sm" className="ml-auto" onClick={onQuiz} disabled={busy}>
            <PlayCircle className="h-4 w-4" /> Quiz me on these
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ol className="space-y-3">
          {items.map((a, i) => {
            const name = (
              <span className="font-medium">
                {i + 1}. {a.label}
              </span>
            );
            return (
              <li key={a.key}>
                <div className="flex items-baseline gap-2 text-sm">
                  {link ? (
                    <Link to={link(a)} className="min-w-0 truncate hover:underline">
                      {name}
                    </Link>
                  ) : (
                    <span className="min-w-0 truncate">{name}</span>
                  )}
                  <span className="ml-auto shrink-0 font-semibold">{pct(a.accuracy)}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {a.correct}/{a.attempts}
                  </span>
                </div>
                <div className="mt-1">
                  <Meter value={a.accuracy} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function AggTable({ title, rows, link }: { title: string; rows: Agg[]; link?: (a: Agg) => string }) {
  const [sort, setSort] = useState<'accuracy' | 'name' | 'questions'>('accuracy');
  const sorted = [...rows].sort((a, b) => {
    if (sort === 'name') return a.label.localeCompare(b.label);
    if (sort === 'questions') return b.questions - a.questions;
    return (a.accuracy ?? 2) - (b.accuracy ?? 2);
  });
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="ml-auto flex gap-1.5">
          {(['accuracy', 'name', 'questions'] as const).map((s) => (
            <Chip key={s} selected={sort === s} onClick={() => setSort(s)}>
              {s === 'accuracy' ? 'Weakest first' : s === 'name' ? 'A–Z' : 'Most questions'}
            </Chip>
          ))}
        </div>
      </div>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-white text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
            <tr>
              <th className="py-1.5 font-medium">Name</th>
              <th className="py-1.5 text-right font-medium">Seen</th>
              <th className="w-1/3 py-1.5 pl-4 font-medium">Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => (
              <tr key={a.key} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-2 pr-2">
                  {link ? (
                    <Link to={link(a)} className="font-medium hover:underline">
                      {a.label}
                    </Link>
                  ) : (
                    <span className="font-medium">{a.label}</span>
                  )}
                  {a.sub && <div className="text-xs text-slate-500">{a.sub}</div>}
                </td>
                <td className="py-2 text-right tabular-nums text-slate-600 dark:text-slate-400">
                  {a.seenQuestions}/{a.questions}
                </td>
                <td className="py-2 pl-4">
                  <div className="flex items-center gap-2">
                    <Meter value={a.accuracy} />
                    <span className="w-10 shrink-0 text-right tabular-nums">{pct(a.accuracy)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
