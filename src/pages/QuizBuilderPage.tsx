import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarRange, Folder as FolderIcon, Search, Shuffle, Sparkles, Target, Timer, RotateCcw } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, Card, Chip, cn, Field, inputClass, PageHeader, SectionTitle } from '../components/ui';
import { db, STATUS_KEYS, type Folder, type QuizConfig, type QuizFilters, type QuizMode, type StatusKey } from '../db';
import { useCandidates } from '../hooks/useBank';
import { formatDuration } from '../lib/dates';
import { autoNames, buildTree, lecturesUnder } from '../lib/org';
import { dayKey, defaultConfig, eligiblePool, matchesFilters, MODE_LABELS, weekKey } from '../lib/selection';
import { hasStatus, STATUS_LABELS } from '../lib/status';
import { createQuiz } from '../lib/tracking';
import { QUESTION_TYPE_LABELS, QUESTION_TYPES, type QuestionType } from '../schema';

const MODES: { mode: QuizMode; icon: ReactNode; desc: string }[] = [
  { mode: 'smart', icon: <Sparkles className="h-5 w-5" />, desc: 'Due reviews → misses → unseen → the rest' },
  { mode: 'unseen', icon: <Target className="h-5 w-5" />, desc: "Only questions you haven't answered" },
  { mode: 'missed', icon: <RotateCcw className="h-5 w-5" />, desc: 'Redemption: wrong last time' },
  { mode: 'weekly', icon: <CalendarRange className="h-5 w-5" />, desc: 'One week, weighted toward weak spots' },
  { mode: 'exam', icon: <Timer className="h-5 w-5" />, desc: 'Timed, NBME-style, feedback at the end' },
];

const LIST_KEYS = ['courses', 'weeks', 'days', 'lectures', 'tags', 'types', 'difficulties', 'statuses'] as const;

function configFromParams(params: URLSearchParams): QuizConfig {
  const c = defaultConfig();
  const mode = params.get('mode') as QuizMode | null;
  if (mode && mode in MODE_LABELS) c.mode = mode;
  const count = Number(params.get('count'));
  if (count > 0) c.count = count;
  if (c.mode === 'exam') c.count = count > 0 ? count : 40;
  for (const k of LIST_KEYS) {
    const v = params.get(k);
    if (!v) continue;
    const parts = v.split(',').filter(Boolean);
    (c.filters as unknown as Record<string, unknown>)[k] = k === 'difficulties' ? parts.map(Number) : parts;
  }
  return c;
}

export function QuizBuilderPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const cands = useCandidates();
  const [config, setConfig] = useState<QuizConfig>(() => configFromParams(params));
  const [lectureSearch, setLectureSearch] = useState('');
  const [tagSearch, setTagSearch] = useState('');
  const [starting, setStarting] = useState(false);
  const folders = useLiveQuery(() => db.folders.toArray(), []);
  const allLectures = useLiveQuery(() => db.lectures.toArray(), []);
  const tree = useMemo(() => (folders && allLectures ? buildTree(folders, allLectures) : null), [folders, allLectures]);
  const names = useMemo(() => autoNames(folders ?? []), [folders]);
  // Folder picks become a lecture filter (OR'd with any lectures picked directly).
  const [folderSel, setFolderSel] = useState<string[]>([]);
  const effective = useMemo(() => {
    if (!folderSel.length || !tree) return config;
    const ids = new Set([...config.filters.lectures, ...folderSel.flatMap((id) => lecturesUnder(tree, id).map((l) => l.lecture_id))]);
    return { ...config, filters: { ...config.filters, lectures: ids.size ? [...ids] : ['(empty folder)'] } };
  }, [config, folderSel, tree]);

  const f = config.filters;
  const setFilters = (patch: Partial<QuizFilters>) => setConfig((c) => ({ ...c, filters: { ...c.filters, ...patch } }));
  const toggle = <K extends keyof QuizFilters>(k: K, v: QuizFilters[K][number]) => {
    const list = f[k] as unknown[];
    setFilters({ [k]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] } as Partial<QuizFilters>);
  };

  const now = Date.now();

  const facets = useMemo(() => {
    const all = cands ?? [];
    const now = Date.now();
    const courses = new Map<string, number>();
    const weeks = new Map<string, { label: string; n: number; course: string; week: number }>();
    const days = new Map<string, { label: string; n: number; date: string; course: string }>();
    const lectures = new Map<string, { title: string; n: number; dayK: string; dayLabel: string; date: string; course: string }>();
    const tags = new Map<string, number>();
    const types = new Map<QuestionType, number>();
    const diffs = new Map<number, number>();
    for (const c of all) {
      const l = c.lecture;
      if (l) {
        courses.set(l.course, (courses.get(l.course) ?? 0) + 1);
        const wk = weekKey(l.course, l.week);
        const w = weeks.get(wk) ?? { label: '', n: 0, course: l.course, week: l.week };
        w.n++;
        weeks.set(wk, w);
        const dk = dayKey(l.course, l.day_label);
        const d = days.get(dk) ?? { label: l.day_label, n: 0, date: l.date, course: l.course };
        d.n++;
        days.set(dk, d);
        const le = lectures.get(l.lecture_id) ?? { title: l.title, n: 0, dayK: dk, dayLabel: l.day_label, date: l.date, course: l.course };
        le.n++;
        lectures.set(l.lecture_id, le);
      }
      for (const t of c.q.tags) tags.set(t.toLowerCase(), (tags.get(t.toLowerCase()) ?? 0) + 1);
      types.set(c.q.type, (types.get(c.q.type) ?? 0) + 1);
      diffs.set(c.q.difficulty, (diffs.get(c.q.difficulty) ?? 0) + 1);
    }
    const statuses = Object.fromEntries(STATUS_KEYS.map((k) => [k, all.filter((c) => hasStatus(c.progress, k, now)).length])) as Record<
      StatusKey,
      number
    >;
    return {
      courses: [...courses].sort(),
      weeks: [...weeks].sort((a, b) => a[1].course.localeCompare(b[1].course) || a[1].week - b[1].week),
      days: [...days].sort((a, b) => a[1].date.localeCompare(b[1].date)),
      lectures: [...lectures].sort((a, b) => a[1].date.localeCompare(b[1].date) || a[0].localeCompare(b[0])),
      tags: [...tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
      types: QUESTION_TYPES.filter((t) => types.has(t)).map((t) => [t, types.get(t)!] as const),
      diffs: [1, 2, 3, 4, 5].map((d) => [d, diffs.get(d) ?? 0] as const),
      statuses,
    };
  }, [cands]);

  if (!cands) return null;

  const filtered = cands.filter((c) => matchesFilters(c, effective.filters, now)).length;
  const eligible = eligiblePool(cands, effective, now).length;
  const serve = Math.min(config.count, eligible);
  const needsWeek = config.mode === 'weekly' && f.weeks.length === 0;
  const activeFilters = LIST_KEYS.reduce((n, k) => n + f[k].length, 0) + folderSel.length;

  const lecturesByDay = new Map<string, { label: string; course: string; items: (typeof facets.lectures)[number][] }>();
  for (const entry of facets.lectures) {
    const [id, l] = entry;
    if (lectureSearch && !`${l.title} ${id} ${l.dayLabel}`.toLowerCase().includes(lectureSearch.toLowerCase())) continue;
    const g = lecturesByDay.get(l.dayK) ?? { label: l.dayLabel, course: l.course, items: [] };
    g.items.push(entry);
    lecturesByDay.set(l.dayK, g);
  }

  function setMode(mode: QuizMode) {
    setConfig((c) => ({
      ...c,
      mode,
      count: mode === 'exam' && c.count === 20 ? 40 : mode !== 'exam' && c.count === 40 && c.mode === 'exam' ? 20 : c.count,
      includeRecentCorrect: mode === 'missed' ? true : c.includeRecentCorrect,
    }));
  }

  async function start() {
    setStarting(true);
    let title = `${MODE_LABELS[config.mode]} · ${serve} Q`;
    if (config.mode === 'weekly') title = `Weekly review · ${f.weeks.map((w) => facets.weeks.find(([k]) => k === w)?.[1].label ?? w).join(', ')}`;
    const s = await createQuiz(effective, title);
    setStarting(false);
    if (s) navigate(`/quiz/${s.id}`);
  }

  return (
    <div className="pb-24">
      <PageHeader title="Build a quiz" subtitle={`${cands.length} questions in your bank`} />

      <section>
        <SectionTitle>Mode</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {MODES.map(({ mode, icon, desc }) => (
            <button
              key={mode}
              type="button"
              onClick={() => setMode(mode)}
              aria-pressed={config.mode === mode}
              className={cn(
                'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors lg:flex-col lg:gap-2',
                config.mode === mode
                  ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500 dark:bg-indigo-950/50'
                  : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700',
              )}
            >
              <span className="text-indigo-600 dark:text-indigo-400">{icon}</span>
              <span>
                <span className="block font-semibold">{MODE_LABELS[mode]}</span>
                <span className="block text-sm text-slate-600 dark:text-slate-400">{desc}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {config.mode === 'weekly' && (
        <Card className={cn('mt-4 p-4', needsWeek && 'border-amber-300 dark:border-amber-800')}>
          <SectionTitle hint="Weak lectures and questions you've missed or guessed on are drawn more often.">Which week?</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {facets.weeks.map(([k, w]) => (
              <Chip key={k} selected={f.weeks.includes(k)} onClick={() => setFilters({ weeks: f.weeks.includes(k) ? [] : [k] })} count={w.n}>
                {w.label}
              </Chip>
            ))}
          </div>
        </Card>
      )}

      <Card className="mt-4 p-4">
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <Field label="Number of questions">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={300}
                className={cn(inputClass, 'w-24')}
                value={config.count}
                onChange={(e) => setConfig((c) => ({ ...c, count: Math.max(1, Number(e.target.value) || 1) }))}
              />
              {[10, 20, 40].map((n) => (
                <Chip key={n} selected={config.count === n} onClick={() => setConfig((c) => ({ ...c, count: n }))}>
                  {n}
                </Chip>
              ))}
            </div>
          </Field>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-indigo-600"
                checked={!config.includeRecentCorrect}
                onChange={(e) => setConfig((c) => ({ ...c, includeRecentCorrect: !e.target.checked }))}
              />
              Skip questions I got right in the last
              <input
                type="number"
                min={0}
                max={60}
                className={cn(inputClass, 'w-16 py-1')}
                value={config.avoidRecentDays}
                onChange={(e) => setConfig((c) => ({ ...c, avoidRecentDays: Math.max(0, Number(e.target.value) || 0) }))}
              />
              days <span className="text-slate-500">(unless due)</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-indigo-600"
                checked={config.shuffleOptions}
                onChange={(e) => setConfig((c) => ({ ...c, shuffleOptions: e.target.checked }))}
              />
              <Shuffle className="h-4 w-4 text-slate-400" /> Shuffle answer choices
            </label>
            {config.mode === 'exam' && (
              <label className="flex items-center gap-2">
                <Timer className="h-4 w-4 text-slate-400" />
                <input
                  type="number"
                  min={20}
                  max={600}
                  className={cn(inputClass, 'w-20 py-1')}
                  value={config.secondsPerQuestion}
                  onChange={(e) => setConfig((c) => ({ ...c, secondsPerQuestion: Math.max(10, Number(e.target.value) || 90) }))}
                />
                seconds per question · block time {formatDuration(serve * config.secondsPerQuestion * 1000)}
              </label>
            )}
          </div>
        </div>
      </Card>

      <Card className="mt-4 p-4">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-base font-semibold">Filters</h2>
          <span className="text-sm text-slate-500">{activeFilters ? `${activeFilters} active · ` : ''}empty = everything</span>
          {activeFilters > 0 && (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => {
                setConfig((c) => ({ ...c, filters: defaultConfig().filters }));
                setFolderSel([]);
              }}
            >
              Clear all
            </Button>
          )}
        </div>
        <div className="space-y-5">
          <FilterGroup label="Status" hint="matches any selected">
            {STATUS_KEYS.map((k) => (
              <Chip key={k} selected={f.statuses.includes(k)} onClick={() => toggle('statuses', k)} count={facets.statuses[k]}>
                {STATUS_LABELS[k]}
              </Chip>
            ))}
          </FilterGroup>

          {facets.courses.length > 1 && (
            <FilterGroup label="Course / block">
              {facets.courses.map(([c, n]) => (
                <Chip key={c} selected={f.courses.includes(c)} onClick={() => toggle('courses', c)} count={n}>
                  {names.course(c)}
                </Chip>
              ))}
            </FilterGroup>
          )}

          {config.mode !== 'weekly' && (
            <FilterGroup label="Week">
              {facets.weeks.map(([k, w]) => (
                <Chip key={k} selected={f.weeks.includes(k)} onClick={() => toggle('weeks', k)} count={w.n}>
                  {facets.courses.length > 1 ? `${names.course(w.course)} · ${names.week(w.course, w.week)}` : names.week(w.course, w.week)}
                </Chip>
              ))}
            </FilterGroup>
          )}

          {tree && (folders?.length ?? 0) > 0 && (
            <div>
              <div className="mb-2 text-sm font-medium">
                Folders <span className="font-normal text-slate-500">· includes subfolders</span>
              </div>
              <div className="max-h-60 overflow-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                {folderRows(tree.children, null, 0).map(({ f: fo, depth }) => {
                  const n = lecturesUnder(tree, fo.id).length;
                  return (
                    <label
                      key={fo.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      style={{ paddingLeft: 4 + depth * 18 }}
                    >
                      <input
                        type="checkbox"
                        className="accent-indigo-600"
                        checked={folderSel.includes(fo.id)}
                        onChange={() => setFolderSel((sel) => (sel.includes(fo.id) ? sel.filter((x) => x !== fo.id) : [...sel, fo.id]))}
                      />
                      <FolderIcon className="h-4 w-4 shrink-0 text-indigo-500" />
                      <span className="flex-1 truncate">{fo.name}</span>
                      <span className="text-xs tabular-nums text-slate-500">
                        {n} lecture{n === 1 ? '' : 's'}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <FilterGroup label="Day">
            {facets.days.map(([k, d]) => (
              <Chip key={k} selected={f.days.includes(k)} onClick={() => toggle('days', k)} count={d.n}>
                {names.day(d.course, d.label)}
              </Chip>
            ))}
          </FilterGroup>

          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-medium">Lectures</span>
              <div className="relative ml-auto w-48">
                <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-slate-400" />
                <input className={cn(inputClass, 'py-1 pl-7')} placeholder="Search lectures" value={lectureSearch} onChange={(e) => setLectureSearch(e.target.value)} />
              </div>
            </div>
            <div className="max-h-72 space-y-3 overflow-auto rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              {[...lecturesByDay].map(([dk, g]) => (
                <div key={dk}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{names.day(g.course, g.label)}</div>
                  {g.items.map(([id, l]) => (
                    <label key={id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <input type="checkbox" className="accent-indigo-600" checked={f.lectures.includes(id)} onChange={() => toggle('lectures', id)} />
                      <span className="flex-1">{l.title}</span>
                      <span className="text-xs tabular-nums text-slate-500">{l.n}</span>
                    </label>
                  ))}
                </div>
              ))}
              {lecturesByDay.size === 0 && <p className="text-sm text-slate-500">No lectures match.</p>}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-medium">Tags</span>
              <div className="relative ml-auto w-48">
                <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-slate-400" />
                <input className={cn(inputClass, 'py-1 pl-7')} placeholder="Search tags" value={tagSearch} onChange={(e) => setTagSearch(e.target.value)} />
              </div>
            </div>
            <div className="flex max-h-40 flex-wrap gap-2 overflow-auto">
              {facets.tags
                .filter(([t]) => !tagSearch || t.includes(tagSearch.toLowerCase()) || f.tags.includes(t))
                .slice(0, tagSearch ? 200 : 40)
                .map(([t, n]) => (
                  <Chip key={t} selected={f.tags.includes(t)} onClick={() => toggle('tags', t)} count={n}>
                    {t}
                  </Chip>
                ))}
            </div>
          </div>

          <FilterGroup label="Question type">
            {facets.types.map(([t, n]) => (
              <Chip key={t} selected={f.types.includes(t)} onClick={() => toggle('types', t)} count={n}>
                {QUESTION_TYPE_LABELS[t]}
              </Chip>
            ))}
          </FilterGroup>

          <FilterGroup label="Difficulty">
            {facets.diffs.map(([d, n]) => (
              <Chip key={d} selected={f.difficulties.includes(d)} onClick={() => toggle('difficulties', d)} count={n} disabled={!n}>
                {'●'.repeat(d)}
                <span className="sr-only">difficulty {d}</span>
              </Chip>
            ))}
          </FilterGroup>
        </div>
      </Card>

      <div className="pb-safe fixed inset-x-0 bottom-16 z-20 border-t border-slate-200 bg-white/95 backdrop-blur sm:bottom-0 dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="text-sm">
            <span className="font-semibold tabular-nums">{filtered}</span> match filters ·{' '}
            <span className="font-semibold tabular-nums">{eligible}</span> eligible for {MODE_LABELS[config.mode].toLowerCase()}
            {eligible < filtered && !config.includeRecentCorrect && config.mode !== 'unseen' && config.mode !== 'missed' && (
              <span className="text-slate-500"> (some answered correctly recently)</span>
            )}
          </div>
          <Button size="lg" className="ml-auto" disabled={!serve || needsWeek || starting} onClick={start}>
            {needsWeek ? 'Pick a week' : `Start ${serve} question${serve === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FilterGroup({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium">
        {label} {hint && <span className="font-normal text-slate-500">· {hint}</span>}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function folderRows(children: Map<string | null, Folder[]>, parent: string | null, depth: number): { f: Folder; depth: number }[] {
  return (children.get(parent) ?? []).flatMap((f) => [{ f, depth }, ...folderRows(children, f.id, depth + 1)]);
}
