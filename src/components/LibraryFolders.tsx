import {
  Archive,
  BookOpen,
  CheckSquare,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Folder as FolderIcon,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Home,
  MoreHorizontal,
  Pencil,
  PlayCircle,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Folder, StoredLecture } from '../db';
import { useStartQuiz } from '../hooks/useStartQuiz';
import { deleteLectures } from '../lib/importer';
import { createFolder, deleteFolder, descendants, lecturesUnder, moveFolder, moveLectures, pathTo, renameFolder, type Tree } from '../lib/org';
import { setLecturesArchived } from '../lib/tracking';
import { emptyFilters, type Candidate } from '../lib/selection';
import { highlight } from './QuestionRow';
import { Button, Card, cn, inputClass, Modal, pct } from './ui';

export const folderUrl = (id: string | null) => (id ? `/library/f/${encodeURIComponent(id)}` : '/library');

export function lectureStats(all: Candidate[]) {
  const cands = all.filter((c) => !c.progress?.archived);
  const seen = cands.filter((c) => c.progress?.timesSeen).length;
  const attempts = cands.reduce((n, c) => n + (c.progress?.timesSeen ?? 0), 0);
  const correct = cands.reduce((n, c) => n + (c.progress?.timesCorrect ?? 0), 0);
  return { total: cands.length, seen, accuracy: attempts ? correct / attempts : null, archived: all.length - cands.length };
}

export function LectureCard({ l, cands, terms = [] }: { l: StoredLecture; cands: Candidate[]; terms?: string[] }) {
  const s = lectureStats(cands);
  return (
    <Link to={`/library/${encodeURIComponent(l.lecture_id)}`} className="block">
      <Card className="flex items-center gap-3 p-4 transition-colors hover:border-indigo-300 dark:hover:border-indigo-800">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{highlight(l.title, terms)}</div>
          <div className="text-sm text-slate-500">
            {l.lecturer && `${l.lecturer} · `}
            {s.total} questions · {s.seen} seen · {pct(s.accuracy)} accuracy
            {s.archived > 0 && ` · ${s.archived} archived`}
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

export function Breadcrumbs({ tree, folderId, tail }: { tree: Tree; folderId: string | null | undefined; tail?: ReactNode }) {
  const path = pathTo(tree, folderId);
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm text-slate-600 dark:text-slate-400" aria-label="Folder path">
      <Link to="/library" className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white">
        <Home className="h-4 w-4" /> Library
      </Link>
      {path.map((f) => (
        <span key={f.id} className="inline-flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
          <Link to={folderUrl(f.id)} className="hover:text-slate-900 dark:hover:text-white">
            {f.name}
          </Link>
        </span>
      ))}
      {tail}
    </nav>
  );
}

const OPEN_KEY = 'qbank-library-open';

function loadOpen(): Set<string> | null {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? 'null');
    return Array.isArray(v) ? new Set(v) : null;
  } catch {
    return null;
  }
}

function saveOpen(open: Set<string>) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
  } catch {
    /* storage blocked: folders just start collapsed next time */
  }
}

type FolderModal = { kind: 'new' | 'rename' | 'move' | 'delete'; folder: Folder | null } | { kind: 'bulk-move' | 'bulk-archive' | 'bulk-delete' };

/**
 * The whole library on one page: folders expand and collapse in place.
 * `focusId` (from a folder link) opens the path to that folder and scrolls to it.
 */
export function FolderTree({ tree, focusId, byLecture }: { tree: Tree; focusId: string | null; byLecture: Map<string, Candidate[]> }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<Set<string>>(() => loadOpen() ?? new Set((tree.children.get(null) ?? []).map((f) => f.id)));
  useEffect(() => saveOpen(open), [open]);
  const [modal, setModal] = useState<FolderModal | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { start, busy, message } = useStartQuiz();

  const stats = useMemo(() => new Map([...byLecture].map(([id, cs]) => [id, lectureStats(cs)])), [byLecture]);
  const questionCount = (ls: StoredLecture[]) => ls.reduce((n, l) => n + (stats.get(l.lecture_id)?.total ?? 0), 0);
  const allLectures = lecturesUnder(tree, null);
  const allFolders = descendants(tree, null);

  // A folder link (e.g. a lecture's breadcrumbs) opens everything down to that folder,
  // once the folder exists (a folder you just created may not have loaded yet).
  const focusReady = !!focusId && tree.byId.has(focusId);
  const [opened, setOpened] = useState<string | null>(null);
  if (focusReady && opened !== focusId) {
    setOpened(focusId);
    setOpen(new Set([...open, ...pathTo(tree, focusId).map((f) => f.id)]));
  }
  useEffect(() => {
    if (focusReady) requestAnimationFrame(() => document.getElementById(`folder-${focusId}`)?.scrollIntoView({ block: 'center' }));
  }, [focusId, focusReady]);

  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };
  const setSel = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const endSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const quizLectures = (ls: StoredLecture[], title: string) => start({ mode: 'smart', count: 20, filters: { ...emptyFilters(), lectures: ls.map((l) => l.lecture_id) } }, title);

  const lectureRow = (l: StoredLecture) => {
    const s = stats.get(l.lecture_id) ?? lectureStats([]);
    const body = (
      <>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{l.title}</span>
          <span className="block truncate text-xs text-slate-500">
            {l.lecturer && `${l.lecturer} · `}
            {s.total} Qs · {s.seen} seen · {pct(s.accuracy)}
            {s.archived > 0 && ` · ${s.archived} archived`}
          </span>
        </span>
        <span className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-slate-200 sm:w-20 dark:bg-slate-800" title={`${s.seen} of ${s.total} seen`} aria-hidden>
          <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${s.total ? (s.seen / s.total) * 100 : 0}%` }} />
        </span>
      </>
    );
    return selecting ? (
      <label key={l.lecture_id} className={cn('flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2', selected.has(l.lecture_id) ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-slate-100 dark:hover:bg-slate-800/60')}>
        <input type="checkbox" className="h-4 w-4 shrink-0 accent-indigo-600" checked={selected.has(l.lecture_id)} onChange={(e) => setSel([l.lecture_id], e.target.checked)} />
        {body}
      </label>
    ) : (
      <Link key={l.lecture_id} to={`/library/${encodeURIComponent(l.lecture_id)}`} className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-slate-100 dark:hover:bg-slate-800/60">
        <BookOpen className="h-4 w-4 shrink-0 text-slate-400" />
        {body}
      </Link>
    );
  };

  const folderNode = (f: Folder, depth: number): ReactNode => {
    if (depth > 20) return null; // a folder cycle from a bad sync shouldn't hang the page
    const isOpen = open.has(f.id);
    const subs = tree.children.get(f.id) ?? [];
    const own = tree.lectures.get(f.id) ?? [];
    const inside = lecturesUnder(tree, f.id);
    const ids = inside.map((l) => l.lecture_id);
    const nSel = ids.filter((id) => selected.has(id)).length;
    const Icon = isOpen ? FolderOpen : FolderIcon;
    return (
      <div key={f.id}>
        <div
          id={`folder-${f.id}`}
          className={cn('flex scroll-mt-32 items-center gap-1 rounded-lg pr-1 hover:bg-slate-100 dark:hover:bg-slate-800/60', focusId === f.id && 'ring-2 ring-inset ring-indigo-400')}
        >
          {selecting && (
            <input
              type="checkbox"
              aria-label={`Select every lecture in ${f.name}`}
              className="ml-2 h-4 w-4 shrink-0 accent-indigo-600"
              disabled={!ids.length}
              checked={ids.length > 0 && nSel === ids.length}
              ref={(el) => {
                if (el) el.indeterminate = nSel > 0 && nSel < ids.length;
              }}
              onChange={(e) => setSel(ids, e.target.checked)}
            />
          )}
          <button type="button" aria-expanded={isOpen} onClick={() => toggle(f.id)} className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-1 text-left">
            <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform duration-150', isOpen && 'rotate-90')} />
            <Icon className="h-5 w-5 shrink-0 text-indigo-500" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{f.name}</span>
              <span className="block truncate text-xs text-slate-500">
                {subs.length > 0 && `${subs.length} folder${subs.length === 1 ? '' : 's'} · `}
                {inside.length} lecture{inside.length === 1 ? '' : 's'} · {questionCount(inside)} Qs
              </span>
            </span>
          </button>
          {!selecting && inside.length > 0 && (
            <button
              type="button"
              title={`Quiz ${f.name}`}
              aria-label={`Quiz ${f.name}`}
              disabled={busy}
              onClick={() => quizLectures(inside, f.name)}
              className="rounded-md p-2 text-indigo-600 hover:bg-indigo-100 dark:text-indigo-400 dark:hover:bg-indigo-950"
            >
              <PlayCircle className="h-5 w-5" />
            </button>
          )}
          {!selecting && (
            <RowMenu
              label={`More for ${f.name}`}
              items={[
                { label: 'New subfolder', icon: FolderPlus, onClick: () => setModal({ kind: 'new', folder: f }) },
                { label: 'Rename', icon: Pencil, onClick: () => setModal({ kind: 'rename', folder: f }) },
                { label: 'Move', icon: FolderInput, onClick: () => setModal({ kind: 'move', folder: f }) },
                { label: 'Delete', icon: Trash2, danger: true, onClick: () => setModal({ kind: 'delete', folder: f }) },
              ]}
            />
          )}
        </div>
        {isOpen && (
          <div className="ml-[17px] border-l border-slate-200 pl-2 dark:border-slate-800">
            {subs.map((c) => folderNode(c, depth + 1))}
            {own.map(lectureRow)}
            {!subs.length && !own.length && <p className="px-2 py-2 text-sm text-slate-500">Empty. Use Move on a lecture to put it here.</p>}
          </div>
        )}
      </div>
    );
  };

  const roots = tree.children.get(null) ?? [];
  const loose = tree.lectures.get(null) ?? [];
  const folder = modal && 'folder' in modal ? modal.folder : null;
  const selectedLectures = allLectures.filter((l) => selected.has(l.lecture_id));
  const anyOpen = allFolders.some((id) => open.has(id));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">Folders</h2>
        {allFolders.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(anyOpen ? new Set() : new Set(allFolders))}>
            {anyOpen ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />} {anyOpen ? 'Collapse all' : 'Expand all'}
          </Button>
        )}
        {allLectures.length > 0 &&
          (selecting ? (
            <Button size="sm" variant="ghost" onClick={endSelect}>
              Done
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setSelecting(true)}>
              <CheckSquare className="h-4 w-4" /> Select
            </Button>
          ))}
        <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'new', folder: null })}>
          <FolderPlus className="h-4 w-4" /> New folder
        </Button>
      </div>
      {message && <p className="mb-3 text-sm text-amber-700 dark:text-amber-400">{message}</p>}

      {roots.length || loose.length ? (
        <Card className="p-1.5">
          {roots.map((f) => folderNode(f, 0))}
          {loose.map(lectureRow)}
        </Card>
      ) : (
        <p className="rounded-xl border-2 border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          No lectures yet. Import a day file on the Add page and it will be filed here automatically.
        </p>
      )}

      {selecting && (
        <div className="sticky bottom-20 z-10 mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:bottom-4 dark:border-slate-800 dark:bg-slate-900/95">
          <span className="mr-auto text-sm font-medium">
            {selected.size} selected
            {selected.size > 0 && (
              <button type="button" className="ml-2 font-normal text-slate-500 underline" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            )}
          </span>
          <Button size="sm" disabled={!selected.size || busy} onClick={() => quizLectures(selectedLectures, `${selected.size} lectures`)}>
            <PlayCircle className="h-4 w-4" /> Quiz
          </Button>
          <Button size="sm" variant="secondary" disabled={!selected.size} onClick={() => setModal({ kind: 'bulk-move' })}>
            <FolderInput className="h-4 w-4" /> Move
          </Button>
          <Button size="sm" variant="secondary" disabled={!selected.size} onClick={() => setModal({ kind: 'bulk-archive' })}>
            <Archive className="h-4 w-4" /> Archive
          </Button>
          <Button size="sm" variant="secondary" className="text-rose-600" disabled={!selected.size} onClick={() => setModal({ kind: 'bulk-delete' })}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </div>
      )}

      {modal?.kind === 'bulk-move' && (
        <FolderPicker
          tree={tree}
          title={`Move ${selected.size} lecture${selected.size === 1 ? '' : 's'} to…`}
          current={null}
          onClose={() => setModal(null)}
          onPick={async (target) => {
            await moveLectures([...selected], target);
            if (target) setOpen(new Set([...open, ...pathTo(tree, target).map((f) => f.id)]));
            endSelect();
          }}
        />
      )}
      {modal?.kind === 'bulk-archive' && (
        <BulkArchiveModal
          lectures={selected.size}
          questions={questionCount(selectedLectures)}
          onClose={() => setModal(null)}
          onApply={async (archived) => {
            await setLecturesArchived([...selected], archived);
            endSelect();
          }}
        />
      )}
      {modal?.kind === 'bulk-delete' && (
        <Modal open onClose={() => setModal(null)} title={`Delete ${selected.size} lecture${selected.size === 1 ? '' : 's'}?`}>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            This removes them and their {questionCount(selectedLectures)} questions, along with your answer history, notes, and flags for them. It can't be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await deleteLectures([...selected]);
                setModal(null);
                endSelect();
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </div>
        </Modal>
      )}
      {modal?.kind === 'new' && (
        <NameModal
          title={folder ? `New folder in ${folder.name}` : 'New folder'}
          initial=""
          onClose={() => setModal(null)}
          onSave={async (name) => {
            const f = await createFolder(name, folder?.id ?? null);
            if (folder) setOpen(new Set([...open, folder.id]));
            navigate(folderUrl(f.id), { replace: true });
          }}
        />
      )}
      {modal?.kind === 'rename' && folder && (
        <NameModal title="Rename folder" initial={folder.name} onClose={() => setModal(null)} onSave={(name) => renameFolder(folder.id, name)} />
      )}
      {modal?.kind === 'move' && folder && (
        <FolderPicker
          tree={tree}
          title={`Move "${folder.name}" to…`}
          current={folder.parentId}
          exclude={descendants(tree, folder.id)}
          onClose={() => setModal(null)}
          onPick={async (target) => {
            await moveFolder(folder.id, target);
            if (target) setOpen(new Set([...open, ...pathTo(tree, target).map((x) => x.id)]));
          }}
        />
      )}
      {modal?.kind === 'delete' && folder && (
        <DeleteFolderModal
          folder={folder}
          lectures={lecturesUnder(tree, folder.id).length}
          questions={questionCount(lecturesUnder(tree, folder.id))}
          onClose={() => setModal(null)}
          onDelete={async (withQuestions) => {
            await deleteFolder(folder.id, { withQuestions });
            if (focusId && descendants(tree, folder.id).includes(focusId)) navigate('/library', { replace: true });
          }}
        />
      )}
    </div>
  );
}

/** A "⋯" button with a small dropdown of actions. */
function RowMenu({ label, items }: { label: string; items: { label: string; icon: LucideIcon; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="rounded-md p-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {items.map(({ label: l, icon: I, onClick, danger }) => (
            <button
              key={l}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onClick();
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm',
                danger ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50' : 'hover:bg-slate-100 dark:hover:bg-slate-800',
              )}
            >
              <I className="h-4 w-4" /> {l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NameModal({ title, initial, onSave, onClose, extra }: { title: string; initial: string; onSave: (name: string) => unknown; onClose: () => void; extra?: ReactNode }) {
  const [name, setName] = useState(initial);
  const save = async () => {
    if (!name.trim()) return;
    await onSave(name.trim());
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={title}>
      <input
        autoFocus
        onFocus={(e) => e.target.select()}
        className={inputClass}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void save()}
        placeholder="Name"
      />
      {extra}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} disabled={!name.trim()}>
          Save
        </Button>
      </div>
    </Modal>
  );
}

/** Pick a destination folder (or the top level). `exclude` hides a folder and its insides when moving a folder. */
export function FolderPicker({
  tree,
  title,
  current,
  exclude = [],
  onPick,
  onClose,
}: {
  tree: Tree;
  title: string;
  current: string | null | undefined;
  exclude?: string[];
  onPick: (folderId: string | null) => unknown;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<string | null>(current ?? null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const rows: { f: Folder; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const f of tree.children.get(parent) ?? []) {
      if (exclude.includes(f.id)) continue;
      rows.push({ f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);

  const option = (id: string | null, label: ReactNode, depth: number) => (
    <button
      key={id ?? 'root'}
      type="button"
      onClick={() => setTarget(id)}
      aria-pressed={target === id}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
        target === id ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800',
      )}
      style={{ paddingLeft: 8 + depth * 18 }}
    >
      {label}
    </button>
  );

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="max-h-80 space-y-0.5 overflow-auto rounded-lg border border-slate-200 p-1 dark:border-slate-700">
        {option(
          null,
          <>
            <Home className="h-4 w-4 shrink-0" /> Top level (no folder)
          </>,
          0,
        )}
        {rows.map(({ f, depth }) =>
          option(
            f.id,
            <>
              <FolderIcon className="h-4 w-4 shrink-0" /> <span className="truncate">{f.name}</span>
            </>,
            depth + 1,
          ),
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          className={inputClass}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={`New folder in ${target ? tree.byId.get(target)?.name : 'top level'}`}
        />
        <Button
          variant="secondary"
          disabled={!newName.trim()}
          onClick={async () => {
            const f = await createFolder(newName, target);
            setNewName('');
            setTarget(f.id);
          }}
        >
          <FolderPlus className="h-4 w-4" /> Create
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={async () => {
            try {
              await onPick(target);
              onClose();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Move here
        </Button>
      </div>
    </Modal>
  );
}

function DeleteFolderModal({
  folder,
  lectures,
  questions,
  onDelete,
  onClose,
}: {
  folder: Folder;
  lectures: number;
  questions: number;
  onDelete: (withQuestions: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [withQuestions, setWithQuestions] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={`Delete "${folder.name}"?`}>
      {lectures === 0 ? (
        <p className="text-sm text-slate-700 dark:text-slate-300">This folder has no lectures in it.</p>
      ) : (
        <div className="space-y-2">
          {[
            { value: false, title: 'Keep what’s inside', desc: `Its ${lectures} lecture${lectures === 1 ? '' : 's'} and subfolders move up one level.` },
            {
              value: true,
              title: 'Delete everything inside',
              desc: `Removes ${lectures} lecture${lectures === 1 ? '' : 's'} and ${questions} questions, with your answer history, notes, and flags for them. Can't be undone.`,
            },
          ].map((o) => (
            <label
              key={String(o.value)}
              className={cn(
                'flex cursor-pointer gap-3 rounded-lg p-3 ring-1 ring-inset',
                withQuestions === o.value ? (o.value ? 'bg-rose-50 ring-rose-400 dark:bg-rose-950/40' : 'bg-indigo-50 ring-indigo-500 dark:bg-indigo-950/40') : 'ring-slate-300 dark:ring-slate-700',
              )}
            >
              <input type="radio" className="mt-1" checked={withQuestions === o.value} onChange={() => setWithQuestions(o.value)} />
              <span>
                <span className="block text-sm font-semibold">{o.title}</span>
                <span className="block text-sm text-slate-600 dark:text-slate-400">{o.desc}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onDelete(withQuestions);
            onClose();
          }}
        >
          <Trash2 className="h-4 w-4" /> Delete folder
        </Button>
      </div>
    </Modal>
  );
}

function BulkArchiveModal({
  lectures,
  questions,
  onApply,
  onClose,
}: {
  lectures: number;
  questions: number;
  onApply: (archived: boolean) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} title={`Archive ${questions} questions?`}>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Every question in the {lectures} selected lecture{lectures === 1 ? '' : 's'} leaves quizzes, exam plans, due counts, and stats. They stay in the Library
        under Archived. You can also unarchive them all here.
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => onApply(false).then(onClose)}>
          Unarchive all
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => onApply(true).then(onClose)}>
          <Archive className="h-4 w-4" /> Archive
        </Button>
      </div>
    </Modal>
  );
}
