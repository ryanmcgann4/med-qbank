import { useLiveQuery } from 'dexie-react-hooks';
import { AlertOctagon, Flag, NotebookPen, Pencil, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { db, type StoredQuestion } from '../db';
import { applyEdit, EditError, revertEdit } from '../lib/edit';
import { updateProgress } from '../lib/tracking';
import { QUESTION_TYPE_LABELS, QUESTION_TYPES, type Question } from '../schema';
import { formatDate } from '../lib/dates';
import { Button, Chip, cn, Field, inputClass, Modal } from './ui';

type Tool = 'flag' | 'note' | 'edit' | 'report';

/** Flag / note / edit / report controls for one question. Progress is read live. */
export function QuestionTools({ question, tools = ['flag', 'note', 'edit', 'report'] }: { question: StoredQuestion; tools?: Tool[] }) {
  const p = useLiveQuery(() => db.progress.get(question.qid), [question.qid]);
  const [open, setOpen] = useState<null | 'note' | 'edit' | 'report'>(null);

  const btn = 'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800';

  return (
    <div className="space-y-2">
      {p?.report && (
        <div className="flex flex-wrap items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span className="flex-1">
            <span className="font-semibold">Reported as possibly incorrect</span> ({formatDate(p.report.at)}): {p.report.reason}
          </span>
          <Button size="sm" variant="ghost" onClick={() => updateProgress(question.qid, { report: null })}>
            Mark resolved
          </Button>
        </div>
      )}
      {tools.includes('note') && p?.note && (
        <button type="button" onClick={() => setOpen('note')} className="block w-full rounded-lg bg-indigo-50 px-3 py-2 text-left text-sm dark:bg-indigo-950/40">
          <span className="font-semibold">Note:</span> <span className="whitespace-pre-line">{p.note}</span>
        </button>
      )}
      <div className="flex flex-wrap gap-2">
        {tools.includes('flag') && (
          <button
            type="button"
            className={cn(btn, p?.flagged && 'bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800')}
            onClick={() => updateProgress(question.qid, { flagged: !p?.flagged })}
            aria-pressed={!!p?.flagged}
          >
            <Flag className={cn('h-4 w-4', p?.flagged && 'fill-current')} /> {p?.flagged ? 'Flagged' : 'Flag'}
          </button>
        )}
        {tools.includes('note') && (
          <button type="button" className={btn} onClick={() => setOpen('note')}>
            <NotebookPen className="h-4 w-4" /> {p?.note ? 'Edit note' : 'Note'}
          </button>
        )}
        {tools.includes('edit') && (
          <button type="button" className={btn} onClick={() => setOpen('edit')}>
            <Pencil className="h-4 w-4" /> Edit question
          </button>
        )}
        {tools.includes('report') && !p?.report && (
          <button type="button" className={btn} onClick={() => setOpen('report')}>
            <AlertOctagon className="h-4 w-4" /> Possibly incorrect?
          </button>
        )}
      </div>

      {open === 'note' && <NoteModal qid={question.qid} initial={p?.note ?? ''} onClose={() => setOpen(null)} />}
      {open === 'report' && <ReportModal qid={question.qid} onClose={() => setOpen(null)} />}
      {open === 'edit' && <EditQuestionModal question={question} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function NoteModal({ qid, initial, onClose }: { qid: string; initial: string; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const save = () => {
    void updateProgress(qid, { note: text.trim() });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Note on this question">
      <textarea
        autoFocus
        rows={5}
        className={inputClass}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
        }}
        placeholder="e.g. Confused NHE3 with ENaC — review slide 18"
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save}>Save note</Button>
      </div>
    </Modal>
  );
}

const REPORT_REASONS = ['Answer key looks wrong', 'Explanation contradicts the lecture', 'Two answers could be right', 'Not covered in lecture', 'Typo / unclear wording'];

export function ReportModal({ qid, onClose }: { qid: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const save = () => {
    void updateProgress(qid, { report: { reason: reason.trim() || 'No reason given', at: Date.now() } });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Report as possibly incorrect">
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
        Reported questions show up under <b>Reported issue</b> in filters and in the Library, so you can check them against the slides.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {REPORT_REASONS.map((r) => (
          <Chip key={r} selected={reason === r} onClick={() => setReason(r)}>
            {r}
          </Chip>
        ))}
      </div>
      <textarea autoFocus rows={3} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What looks wrong?" />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save}>Report</Button>
      </div>
    </Modal>
  );
}

export function EditQuestionModal({ question, onClose }: { question: StoredQuestion; onClose: () => void }) {
  const [draft, setDraft] = useState<Question>(() => structuredClone(question));
  const [tags, setTags] = useState(question.tags.join(', '));
  const [errors, setErrors] = useState<string[]>([]);

  const set = <K extends keyof Question>(k: K, v: Question[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setOption = (i: number, patch: Partial<Question['options'][number]>) =>
    setDraft((d) => ({ ...d, options: d.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) }));

  async function save() {
    try {
      const next = applyEdit(question, { ...draft, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) });
      await db.questions.put(next);
      onClose();
    } catch (e) {
      setErrors(e instanceof EditError ? e.issues : [(e as Error).message]);
    }
  }

  async function revert() {
    await db.questions.put(revertEdit(question));
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={`Edit ${question.qid}`} wide>
      <div className="space-y-4">
        <Field label="Stem">
          <textarea rows={5} className={inputClass} value={draft.stem} onChange={(e) => set('stem', e.target.value)} />
        </Field>
        <div>
          <div className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Options (select the correct one)</div>
          <div className="space-y-3">
            {draft.options.map((o, i) => (
              <div key={o.id} className={cn('rounded-lg border p-3', draft.correct_option === o.id ? 'border-emerald-500' : 'border-slate-200 dark:border-slate-700')}>
                <label className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <input type="radio" name="correct" className="accent-emerald-600" checked={draft.correct_option === o.id} onChange={() => set('correct_option', o.id)} />
                  {o.id}
                  {draft.correct_option === o.id && <span className="font-normal text-emerald-700 dark:text-emerald-400">correct answer</span>}
                </label>
                <input className={inputClass} value={o.text} onChange={(e) => setOption(i, { text: e.target.value })} aria-label={`Option ${o.id} text`} />
                <textarea
                  rows={2}
                  className={cn(inputClass, 'mt-2')}
                  value={o.explanation}
                  onChange={(e) => setOption(i, { explanation: e.target.value })}
                  aria-label={`Option ${o.id} explanation`}
                  placeholder="Why this option is right or wrong"
                />
              </div>
            ))}
          </div>
        </div>
        <Field label="Explanation">
          <textarea rows={5} className={inputClass} value={draft.explanation} onChange={(e) => set('explanation', e.target.value)} />
        </Field>
        <Field label="Key takeaway">
          <input className={inputClass} value={draft.key_takeaway} onChange={(e) => set('key_takeaway', e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Slides">
            <input className={inputClass} value={draft.source.slides} onChange={(e) => set('source', { ...draft.source, slides: e.target.value })} />
          </Field>
          <div className="sm:col-span-3">
            <Field label="Objective">
              <input className={inputClass} value={draft.source.objective ?? ''} onChange={(e) => set('source', { ...draft.source, objective: e.target.value || undefined })} />
            </Field>
          </div>
          <Field label="Type">
            <select className={inputClass} value={draft.type} onChange={(e) => set('type', e.target.value as Question['type'])}>
              {QUESTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {QUESTION_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Difficulty">
            <select className={inputClass} value={draft.difficulty} onChange={(e) => set('difficulty', Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Tags" hint="comma-separated">
              <input className={inputClass} value={tags} onChange={(e) => setTags(e.target.value)} />
            </Field>
          </div>
        </div>

        {errors.length > 0 && (
          <ul className="list-disc rounded-lg bg-rose-50 p-3 pl-8 text-sm text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          {question.original && (
            <Button variant="ghost" onClick={revert}>
              <Undo2 className="h-4 w-4" /> Revert to imported version
            </Button>
          )}
          <span className="text-xs text-slate-500">Your answer history is kept. The question gets an “edited” marker.</span>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save}>Save changes</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
