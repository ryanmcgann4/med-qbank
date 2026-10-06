import { useLiveQuery } from 'dexie-react-hooks';
import { FolderInput, Pencil, PlayCircle, Search, Trash2 } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Breadcrumbs, folderUrl, FolderPicker, FolderView, LectureCard, lectureStats, NameModal } from '../components/LibraryFolders';
import { QuestionRow } from '../components/QuestionRow';
import { Badge, Button, Card, Chip, cn, inputClass, Modal, PageHeader, pct } from '../components/ui';
import { db, type StoredLecture } from '../db';
import { useCandidates } from '../hooks/useBank';
import { useStartQuiz } from '../hooks/useStartQuiz';
import { deleteLectures } from '../lib/importer';
import { normalizeText } from '../lib/hash';
import { buildTree, ensureOrganization, moveLectures, renameLecture, type Tree } from '../lib/org';
import { emptyFilters, type Candidate } from '../lib/selection';
import { hasStatus } from '../lib/status';

type Filter = 'all' | 'flagged' | 'reported' | 'edited' | 'missed' | 'unseen' | 'archived';
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['missed', 'Missed'],
  ['flagged', 'Flagged'],
  ['reported', 'Reported'],
  ['edited', 'Edited'],
  ['unseen', 'Unseen'],
  ['archived', 'Archived'],
];

/** Archived questions only appear under the Archived filter (and on their lecture's page). */
function matchesFilter(c: Candidate, f: Filter, now: number): boolean {
  if (f === 'archived') return !!c.progress?.archived;
  if (c.progress?.archived) return false;
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

export function LibraryPage() {
  const { lectureId, folderId } = useParams();
  const cands = useCandidates({ includeArchived: true });
  const lectures = useLiveQuery(() => db.lectures.toArray(), []);
  const folders = useLiveQuery(() => db.folders.toArray(), []);
  useEffect(() => {
    void ensureOrganization();
  }, []);
  const tree = useMemo(() => (folders && lectures ? buildTree(folders, lectures) : null), [folders, lectures]);
  if (!cands || !lectures || !tree) return null;
  if (lectureId) return <LectureDetail lectureId={lectureId} cands={cands} lectures={lectures} tree={tree} />;
  return <LibraryIndex cands={cands} lectures={lectures} tree={tree} folderId={folderId ?? null} />;
}

function LibraryIndex({ cands, lectures, tree, folderId }: { cands: Candidate[]; lectures: StoredLecture[]; tree: Tree; folderId: string | null }) {
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
        <div className="mt-6">
          <FolderView tree={tree} folderId={folderId} byLecture={byLecture} />
        </div>
      )}
    </div>
  );
}

function LectureDetail({ lectureId, cands, lectures, tree }: { lectureId: string; cands: Candidate[]; lectures: StoredLecture[]; tree: Tree }) {
  const l = lectures.find((x) => x.lecture_id === lectureId);
  const [modal, setModal] = useState<null | 'rename' | 'move'>(null);
  // Archived questions are listed last; everything else on this page counts only active ones.
  const mine = cands
    .filter((c) => c.q.lecture_id === lectureId)
    .sort((a, b) => Number(!!a.progress?.archived) - Number(!!b.progress?.archived) || a.q.qid.localeCompare(b.q.qid));
  const active = mine.filter((c) => !c.progress?.archived);
  const { start, busy, message } = useStartQuiz();
  const navigate = useNavigate();
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
  const unseen = active.filter((c) => hasStatus(c.progress, 'unseen', now)).length;
  const filters = { ...emptyFilters(), lectures: [lectureId] };
  const objectiveCount = (o: string) => {
    const n = normalizeText(o);
    return mine.filter((c) => c.q.source.objective && normalizeText(c.q.source.objective) === n).length;
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumbs tree={tree} folderId={l.folderId} />
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
          <span>
            {s.total} questions{s.archived > 0 && ` (+${s.archived} archived)`}
          </span>
          <span>
            {s.seen} seen · {unseen} unseen
          </span>
          <span>{pct(s.accuracy)} accuracy</span>
          <code className="text-xs">{l.lecture_id}</code>
        </div>
      </Card>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={busy || !active.length} onClick={() => start({ mode: 'smart', count: 20, filters }, `${l.title}`)}>
          <PlayCircle className="h-4 w-4" /> Quiz this lecture
        </Button>
        <Button variant="secondary" disabled={busy || !unseen} onClick={() => start({ mode: 'unseen', count: 50, filters }, `${l.title} · unseen`)}>
          Unseen only ({unseen})
        </Button>
        <Button
          variant="secondary"
          disabled={busy || !active.length}
          onClick={() => start({ mode: 'custom', qids: active.map((c) => c.q.qid), count: active.length, includeRecentCorrect: true }, `${l.title} · all`)}
        >
          All {active.length}
        </Button>
        <span className="ml-auto flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => setModal('rename')}>
            <Pencil className="h-4 w-4" /> Rename
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setModal('move')}>
            <FolderInput className="h-4 w-4" /> Move
          </Button>
          <DeleteLectures name={l.title} lectures={[l]} questions={mine.length} label="Delete" onDone={() => navigate(folderUrl(l.folderId ?? null))} />
        </span>
      </div>
      {modal === 'rename' && (
        <NameModal
          title="Rename lecture"
          initial={l.title}
          onClose={() => setModal(null)}
          onSave={(name) => renameLecture(l.lecture_id, name)}
          extra={
            l.importedTitle &&
            l.importedTitle !== l.title && (
              <button
                type="button"
                className="mt-2 text-sm text-indigo-600 underline dark:text-indigo-400"
                onClick={async () => {
                  await renameLecture(l.lecture_id, null);
                  setModal(null);
                }}
              >
                Reset to “{l.importedTitle}”
              </button>
            )
          }
        />
      )}
      {modal === 'move' && (
        <FolderPicker
          tree={tree}
          title={`Move "${l.title}" to…`}
          current={l.folderId}
          onClose={() => setModal(null)}
          onPick={(target) => moveLectures([l.lecture_id], target)}
        />
      )}
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

/** Delete one or more lectures with their questions and history, after confirming. */
function DeleteLectures({
  name,
  lectures,
  questions,
  label,
  onDone,
}: {
  name: string;
  lectures: StoredLecture[];
  questions: number;
  label: string;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    await deleteLectures(lectures.map((l) => l.lecture_id));
    setBusy(false);
    setOpen(false);
    onDone?.();
  }

  return (
    <>
      <Button size="sm" variant="ghost" className="text-slate-500 hover:text-rose-600 dark:hover:text-rose-400" onClick={() => setOpen(true)}>
        <Trash2 className="h-4 w-4" /> {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Delete ${name}?`}>
        <p className="text-sm text-slate-700 dark:text-slate-300">
          This removes {lectures.length === 1 ? 'this lecture' : `${lectures.length} lectures`} and {questions} question{questions === 1 ? '' : 's'}, along with
          your answer history, notes, and flags for them. It can't be undone.
        </p>
        {lectures.length > 1 && (
          <ul className="mt-2 list-disc pl-5 text-sm text-slate-600 dark:text-slate-400">
            {lectures.map((l) => (
              <li key={l.lecture_id}>{l.title}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-sm text-slate-500">
          Want a copy first? Use <Link to="/data" className="underline">Data → Download backup</Link>.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} disabled={busy}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </div>
      </Modal>
    </>
  );
}
