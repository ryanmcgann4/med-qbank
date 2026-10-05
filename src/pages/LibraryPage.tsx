import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ChevronRight, PlayCircle, Search } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { QuestionRow, highlight } from '../components/QuestionRow';
import { Badge, Button, Card, Chip, cn, inputClass, PageHeader, pct } from '../components/ui';
import { db, type StoredLecture } from '../db';
import { useCandidates } from '../hooks/useBank';
import { useStartQuiz } from '../hooks/useStartQuiz';
import { formatDate } from '../lib/dates';
import { normalizeText } from '../lib/hash';
import { emptyFilters, type Candidate } from '../lib/selection';
import { hasStatus } from '../lib/status';

type Filter = 'all' | 'flagged' | 'reported' | 'edited' | 'missed' | 'unseen';
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['missed', 'Missed'],
  ['flagged', 'Flagged'],
  ['reported', 'Reported'],
  ['edited', 'Edited'],
  ['unseen', 'Unseen'],
];

function matchesFilter(c: Candidate, f: Filter, now: number): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'edited':
      return !!c.q.editedAt;
    default:
      return hasStatus(c.progress, f, now);
  }
}

function haystack(c: Candidate): string {
  const q = c.q;
  return [q.qid, q.stem, ...q.options.flatMap((o) => [o.text, o.explanation]), q.explanation, q.key_takeaway, q.source.objective ?? '', ...q.tags, c.lecture?.title ?? '']
    .join(' ')
    .toLowerCase();
}

function lectureStats(cands: Candidate[]) {
  const seen = cands.filter((c) => c.progress?.timesSeen).length;
  const attempts = cands.reduce((n, c) => n + (c.progress?.timesSeen ?? 0), 0);
  const correct = cands.reduce((n, c) => n + (c.progress?.timesCorrect ?? 0), 0);
  return { total: cands.length, seen, accuracy: attempts ? correct / attempts : null };
}

export function LibraryPage() {
  const { lectureId } = useParams();
  const cands = useCandidates();
  const lectures = useLiveQuery(() => db.lectures.toArray(), []);
  if (!cands || !lectures) return null;
  if (lectureId) return <LectureDetail lectureId={lectureId} cands={cands} lectures={lectures} />;
  return <LibraryIndex cands={cands} lectures={lectures} />;
}

function LibraryIndex({ cands, lectures }: { cands: Candidate[]; lectures: StoredLecture[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(50);
  const deferred = useDeferredValue(query);
  const terms = deferred.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const now = Date.now();

  const index = useMemo(() => new Map(cands.map((c) => [c.q.qid, haystack(c)])), [cands]);
  const byLecture = useMemo(() => {
    const m = new Map<string, Candidate[]>();
    for (const c of cands) m.set(c.q.lecture_id, [...(m.get(c.q.lecture_id) ?? []), c]);
    return m;
  }, [cands]);

  const searching = terms.length > 0 || filter !== 'all';
  const results = searching
    ? cands
        .filter((c) => matchesFilter(c, filter, now))
        .filter((c) => terms.every((t) => index.get(c.q.qid)!.includes(t)))
        .sort((a, b) => a.q.qid.localeCompare(b.q.qid))
    : [];
  const lectureHits = terms.length
    ? lectures.filter((l) => {
        const h = [l.title, l.summary, l.lecturer, ...l.learning_objectives].join(' ').toLowerCase();
        return terms.every((t) => h.includes(t));
      })
    : [];

  // Week → day → lectures, newest first.
  const weeks = useMemo(() => {
    const w = new Map<string, { label: string; days: Map<string, { label: string; date: string; lectures: StoredLecture[] }> }>();
    for (const l of [...lectures].sort((a, b) => b.date.localeCompare(a.date) || a.lecture_id.localeCompare(b.lecture_id))) {
      const wk = `${l.course}::${l.week}`;
      const week = w.get(wk) ?? { label: `${l.course} · Week ${l.week}`, days: new Map() };
      const dk = `${l.course}::${l.day_label}`;
      const day = week.days.get(dk) ?? { label: l.day_label, date: l.date, lectures: [] };
      day.lectures.push(l);
      week.days.set(dk, day);
      w.set(wk, week);
    }
    return [...w.values()];
  }, [lectures]);

  return (
    <div>
      <PageHeader title="Library" subtitle={`${lectures.length} lectures · ${cands.length} questions`} />
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
        <input
          type="search"
          className={cn(inputClass, 'py-2.5 pl-9 text-base')}
          placeholder="Search stems, answers, explanations, tags, lectures…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(50);
          }}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {FILTERS.map(([f, label]) => (
          <Chip key={f} selected={filter === f} onClick={() => setFilter(f)} count={f === 'all' ? undefined : cands.filter((c) => matchesFilter(c, f, now)).length}>
            {label}
          </Chip>
        ))}
      </div>

      {searching ? (
        <div className="mt-6 space-y-6">
          {lectureHits.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Lectures</h2>
              <div className="space-y-2">
                {lectureHits.map((l) => (
                  <LectureCard key={l.lecture_id} l={l} cands={byLecture.get(l.lecture_id) ?? []} terms={terms} />
                ))}
              </div>
            </section>
          )}
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              {results.length} question{results.length === 1 ? '' : 's'}
            </h2>
            <div className="space-y-2">
              {results.slice(0, limit).map((c) => (
                <QuestionRow key={c.q.qid} c={c} terms={terms} />
              ))}
            </div>
            {results.length > limit && (
              <Button variant="secondary" className="mt-3" onClick={() => setLimit(limit + 50)}>
                Show more ({results.length - limit} left)
              </Button>
            )}
          </section>
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {weeks.map((w) => (
            <section key={w.label}>
              <h2 className="mb-3 text-lg font-semibold">{w.label}</h2>
              <div className="space-y-4">
                {[...w.days.values()].map((d) => (
                  <div key={d.label}>
                    <div className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-400">
                      {d.label} <span className="text-slate-400">· {formatDate(d.date)}</span>
                    </div>
                    <div className="space-y-2">
                      {d.lectures.map((l) => (
                        <LectureCard key={l.lecture_id} l={l} cands={byLecture.get(l.lecture_id) ?? []} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {weeks.length === 0 && <p className="text-slate-500">No lectures yet. Import a day file on the Add page.</p>}
        </div>
      )}
    </div>
  );
}

function LectureCard({ l, cands, terms = [] }: { l: StoredLecture; cands: Candidate[]; terms?: string[] }) {
  const s = lectureStats(cands);
  return (
    <Link to={`/library/${encodeURIComponent(l.lecture_id)}`} className="block">
      <Card className="flex items-center gap-3 p-4 transition-colors hover:border-indigo-300 dark:hover:border-indigo-800">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{highlight(l.title, terms)}</div>
          <div className="text-sm text-slate-500">
            {l.lecturer && `${l.lecturer} · `}
            {s.total} questions · {s.seen} seen · {pct(s.accuracy)} accuracy
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" aria-hidden>
            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${s.total ? (s.seen / s.total) * 100 : 0}%` }} />
          </div>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
      </Card>
    </Link>
  );
}

function LectureDetail({ lectureId, cands, lectures }: { lectureId: string; cands: Candidate[]; lectures: StoredLecture[] }) {
  const l = lectures.find((x) => x.lecture_id === lectureId);
  const mine = cands.filter((c) => c.q.lecture_id === lectureId).sort((a, b) => a.q.qid.localeCompare(b.q.qid));
  const { start, busy, message } = useStartQuiz();
  const now = Date.now();

  if (!l) {
    return (
      <div className="py-16 text-center">
        <p className="mb-4">Lecture not found.</p>
        <Link to="/library" className="text-indigo-600 underline">
          Back to library
        </Link>
      </div>
    );
  }

  const s = lectureStats(mine);
  const unseen = mine.filter((c) => hasStatus(c.progress, 'unseen', now)).length;
  const filters = { ...emptyFilters(), lectures: [lectureId] };
  const objectiveCount = (o: string) => {
    const n = normalizeText(o);
    return mine.filter((c) => c.q.source.objective && normalizeText(c.q.source.objective) === n).length;
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/library" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Library
      </Link>
      <PageHeader
        title={l.title}
        subtitle={
          <>
            {l.day_label} · {l.course}
            {l.lecturer && ` · ${l.lecturer}`}
          </>
        }
      />
      <Card className="p-5">
        {l.summary && <p className="leading-relaxed">{l.summary}</p>}
        {l.learning_objectives.length > 0 && (
          <>
            <h2 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Learning objectives <span className="font-normal normal-case tracking-normal">· questions citing each</span>
            </h2>
            <ul className="space-y-1.5">
              {l.learning_objectives.map((o, i) => {
                const n = objectiveCount(o);
                return (
                  <li key={i} className="flex gap-2">
                    <span className="text-slate-400">{i + 1}.</span>
                    <span className="flex-1">{o}</span>
                    <Badge tone={n ? 'neutral' : 'amber'}>{n} Q</Badge>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600 dark:text-slate-400">
          <span>{s.total} questions</span>
          <span>
            {s.seen} seen · {unseen} unseen
          </span>
          <span>{pct(s.accuracy)} accuracy</span>
          <code className="text-xs">{l.lecture_id}</code>
        </div>
      </Card>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={busy || !mine.length} onClick={() => start({ mode: 'smart', count: 20, filters }, `${l.title}`)}>
          <PlayCircle className="h-4 w-4" /> Quiz this lecture
        </Button>
        <Button variant="secondary" disabled={busy || !unseen} onClick={() => start({ mode: 'unseen', count: 50, filters }, `${l.title} · unseen`)}>
          Unseen only ({unseen})
        </Button>
        <Button
          variant="secondary"
          disabled={busy || !mine.length}
          onClick={() => start({ mode: 'custom', qids: mine.map((c) => c.q.qid), count: mine.length, includeRecentCorrect: true }, `${l.title} · all`)}
        >
          All {mine.length}
        </Button>
      </div>
      {message && <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{message}</p>}

      <h2 className="mb-3 mt-8 text-base font-semibold">Questions</h2>
      <div className="space-y-2">
        {mine.map((c) => (
          <QuestionRow key={c.q.qid} c={c} showLecture={false} />
        ))}
      </div>
    </div>
  );
}
