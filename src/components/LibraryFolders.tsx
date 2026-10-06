import { Archive, CheckSquare, ChevronRight, Folder as FolderIcon, FolderInput, FolderPlus, Home, Pencil, PlayCircle, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
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

/** One level of the library: its subfolders and the lectures filed directly in it. */
export function FolderView({ tree, folderId, byLecture }: { tree: Tree; folderId: string | null; byLecture: Map<string, Candidate[]> }) {
  const navigate = useNavigate();
  const folder = folderId ? tree.byId.get(folderId) : undefined;
  const [modal, setModal] = useState<null | 'new' | 'rename' | 'move' | 'delete' | 'bulk-move' | 'bulk-archive' | 'bulk-delete'>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) => setSelected((s) => new Set(s.has(id) ? [...s].filter((x) => x !== id) : [...s, id]));
  const endSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const { start, busy, message } = useStartQuiz();
  const subfolders = tree.children.get(folderId) ?? [];
  const lectures = tree.lectures.get(folderId) ?? [];
  const inside = lecturesUnder(tree, folderId);
  const questionCount = (ls: StoredLecture[]) => ls.reduce((n, l) => n + lectureStats(byLecture.get(l.lecture_id) ?? []).total, 0);

  if (folderId && !folder) {
    return (
      <p className="py-10 text-center text-slate-500">
        That folder was deleted. <Link to="/library" className="underline">Back to the Library</Link>
      </p>
    );
  }

  return (
    <div>
      {folder && <Breadcrumbs tree={tree} folderId={folder.parentId} />}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto flex items-center gap-2 text-lg font-semibold">
          {folder && <FolderIcon className="h-5 w-5 text-indigo-600" />}
          {folder ? folder.name : 'Folders'}
        </h2>
        {folder && inside.length > 0 && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => start({ mode: 'smart', count: 20, filters: { ...emptyFilters(), lectures: inside.map((l) => l.lecture_id) } }, folder.name)}
          >
            <PlayCircle className="h-4 w-4" /> Quiz this folder
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => setModal('new')}>
          <FolderPlus className="h-4 w-4" /> {folder ? 'New subfolder' : 'New folder'}
        </Button>
        {folder && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setModal('rename')}>
              <Pencil className="h-4 w-4" /> Rename
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setModal('move')}>
              <FolderInput className="h-4 w-4" /> Move
            </Button>
            <Button size="sm" variant="ghost" className="text-slate-500 hover:text-rose-600" onClick={() => setModal('delete')}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </>
        )}
      </div>
      {message && <p className="mb-3 text-sm text-amber-700 dark:text-amber-400">{message}</p>}

      <div className="space-y-2">
        {subfolders.map((f) => {
          const ls = lecturesUnder(tree, f.id);
          const n = (tree.children.get(f.id) ?? []).length;
          return (
            <Link key={f.id} to={folderUrl(f.id)} className="block">
              <Card className="flex items-center gap-3 p-4 transition-colors hover:border-indigo-300 dark:hover:border-indigo-800">
                <FolderIcon className="h-5 w-5 shrink-0 text-indigo-500" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{f.name}</div>
                  <div className="text-sm text-slate-500">
                    {n > 0 && `${n} folder${n === 1 ? '' : 's'} · `}
                    {ls.length} lecture{ls.length === 1 ? '' : 's'} · {questionCount(ls)} questions
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
              </Card>
            </Link>
          );
        })}
        {lectures.length > 0 && (
          <div className="flex items-center gap-2 pt-1 text-sm">
            {selecting ? (
              <>
                <button type="button" className="text-indigo-600 underline dark:text-indigo-400" onClick={() => setSelected(new Set(lectures.map((l) => l.lecture_id)))}>
                  Select all {lectures.length}
                </button>
                {selected.size > 0 && (
                  <button type="button" className="text-slate-500 underline" onClick={() => setSelected(new Set())}>
                    Clear
                  </button>
                )}
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setSelecting(true)}>
                <CheckSquare className="h-4 w-4" /> Select lectures
              </Button>
            )}
          </div>
        )}
        {lectures.map((l) =>
          selecting ? (
            <SelectableLecture key={l.lecture_id} l={l} cands={byLecture.get(l.lecture_id) ?? []} checked={selected.has(l.lecture_id)} onToggle={() => toggleSel(l.lecture_id)} />
          ) : (
            <LectureCard key={l.lecture_id} l={l} cands={byLecture.get(l.lecture_id) ?? []} />
          ),
        )}
        {!subfolders.length && !lectures.length && (
          <p className="rounded-xl border-2 border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
            {folder
              ? 'Empty folder. Add a subfolder, or open a lecture and use Move to put it here.'
              : 'No lectures yet. Import a day file on the Add page and it will be filed here automatically.'}
          </p>
        )}
      </div>

      {selecting && (
        <div className="sticky bottom-20 z-10 mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:bottom-4 dark:border-slate-800 dark:bg-slate-900/95">
          <span className="mr-auto text-sm font-medium">{selected.size} selected</span>
          <Button
            size="sm"
            disabled={!selected.size || busy}
            onClick={() => start({ mode: 'smart', count: 20, filters: { ...emptyFilters(), lectures: [...selected] } }, `${selected.size} lectures`)}
          >
            <PlayCircle className="h-4 w-4" /> Quiz
          </Button>
          <Button size="sm" variant="secondary" disabled={!selected.size} onClick={() => setModal('bulk-move')}>
            <FolderInput className="h-4 w-4" /> Move
          </Button>
          <Button size="sm" variant="secondary" disabled={!selected.size} onClick={() => setModal('bulk-archive')}>
            <Archive className="h-4 w-4" /> Archive
          </Button>
          <Button size="sm" variant="secondary" className="text-rose-600" disabled={!selected.size} onClick={() => setModal('bulk-delete')}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={endSelect}>
            Done
          </Button>
        </div>
      )}
      {modal === 'bulk-move' && (
        <FolderPicker
          tree={tree}
          title={`Move ${selected.size} lecture${selected.size === 1 ? '' : 's'} to…`}
          current={folderId}
          onClose={() => setModal(null)}
          onPick={async (target) => {
            await moveLectures([...selected], target);
            endSelect();
          }}
        />
      )}
      {modal === 'bulk-archive' && (
        <BulkArchiveModal
          lectures={selected.size}
          questions={questionCount(lectures.filter((l) => selected.has(l.lecture_id)))}
          onClose={() => setModal(null)}
          onApply={async (archived) => {
            await setLecturesArchived([...selected], archived);
            endSelect();
          }}
        />
      )}
      {modal === 'bulk-delete' && (
        <Modal open onClose={() => setModal(null)} title={`Delete ${selected.size} lecture${selected.size === 1 ? '' : 's'}?`}>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            This removes them and their {questionCount(lectures.filter((l) => selected.has(l.lecture_id)))} questions, along with your answer history, notes, and flags
            for them. It can't be undone.
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
      {modal === 'new' && (
        <NameModal
          title={folder ? `New folder in ${folder.name}` : 'New folder'}
          initial=""
          onClose={() => setModal(null)}
          onSave={async (name) => {
            const f = await createFolder(name, folderId);
            navigate(folderUrl(f.id));
          }}
        />
      )}
      {modal === 'rename' && folder && (
        <NameModal title="Rename folder" initial={folder.name} onClose={() => setModal(null)} onSave={(name) => renameFolder(folder.id, name)} />
      )}
      {modal === 'move' && folder && (
        <FolderPicker
          tree={tree}
          title={`Move "${folder.name}" to…`}
          current={folder.parentId}
          exclude={descendants(tree, folder.id)}
          onClose={() => setModal(null)}
          onPick={(target) => moveFolder(folder.id, target)}
        />
      )}
      {modal === 'delete' && folder && (
        <DeleteFolderModal
          folder={folder}
          lectures={inside.length}
          questions={questionCount(inside)}
          onClose={() => setModal(null)}
          onDelete={async (withQuestions) => {
            await deleteFolder(folder.id, { withQuestions });
            navigate(folderUrl(tree.byId.has(folder.parentId ?? '') ? folder.parentId : null));
          }}
        />
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

function SelectableLecture({ l, cands, checked, onToggle }: { l: StoredLecture; cands: Candidate[]; checked: boolean; onToggle: () => void }) {
  const s = lectureStats(cands);
  return (
    <label className="block cursor-pointer">
      <Card className={cn('flex items-center gap-3 p-4 transition-colors', checked && 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/40')}>
        <input type="checkbox" className="h-5 w-5 accent-indigo-600" checked={checked} onChange={onToggle} />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{l.title}</div>
          <div className="text-sm text-slate-500">
            {s.total} questions · {s.seen} seen{s.archived > 0 && ` · ${s.archived} archived`}
          </div>
        </div>
      </Card>
    </label>
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
