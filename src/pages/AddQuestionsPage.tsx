import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ClipboardCopy, ClipboardPaste, Download, PartyPopper, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Badge, Button, Card, cn, Field, inputClass, PageHeader, SectionTitle } from '../components/ui';
import { ImportPreview } from '../components/ImportPreview';
import { db } from '../db';
import { todayISO } from '../lib/dates';
import { planImport, type ImportOutcome, type ImportPlan, type ImportSource } from '../lib/importer';
import { buildGeneratorPrompt, fileNameFor, suggestedDayLabel, type PromptInputs } from '../lib/prompt';
import { defaultConfig } from '../lib/selection';
import { createQuiz } from '../lib/tracking';

const FORM_KEY = 'qbank-prompt-form';
const SAMPLE_URL = `${import.meta.env.BASE_URL}sample/B2_W6_D1_2026-10-05.json`;

type Scope = 'none' | 'day' | 'week' | 'course';

interface FormState extends Omit<PromptInputs, 'existing'> {
  dayLabelEdited: boolean;
  scope: Scope;
}

function loadForm(): FormState {
  const base: FormState = {
    course: 'Block 2',
    code: 'B2',
    week: '',
    day: '',
    date: todayISO(),
    dayLabel: '',
    lectureNotes: '',
    dayLabelEdited: false,
    scope: 'week',
  };
  try {
    const saved = JSON.parse(localStorage.getItem(FORM_KEY) ?? '{}');
    // Date always starts at today; everything else carries over between days.
    return { ...base, ...saved, date: todayISO() };
  } catch {
    return base;
  }
}

export function AddQuestionsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const startPlan = useCallback(async (sources: ImportSource[]) => {
    if (!sources.length) return;
    setPlanning(true);
    setOutcome(null);
    setLoadError(null);
    try {
      setPlan(await planImport(sources));
      requestAnimationFrame(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setPlanning(false);
    }
  }, []);

  const loadSample = useCallback(async () => {
    try {
      const res = await fetch(SAMPLE_URL);
      await startPlan([{ name: 'B2_W6_D1_2026-10-05.json (sample)', text: await res.text() }]);
    } catch (e) {
      setLoadError(`Couldn't load the sample file: ${(e as Error).message}`);
    }
  }, [startPlan]);

  useEffect(() => {
    if (params.get('sample') === '1') {
      setParams({}, { replace: true });
      void loadSample();
    }
  }, [params, setParams, loadSample]);

  async function quizOnImported() {
    if (!outcome) return;
    const s = await createQuiz(
      { ...defaultConfig(), mode: 'custom', qids: outcome.qids, count: outcome.qids.length, includeRecentCorrect: true },
      'Just imported',
    );
    if (s) navigate(`/quiz/${s.id}`);
  }

  return (
    <div>
      <PageHeader
        title="Add questions"
        subtitle="Generate a day's questions in Claude, then drop the JSON file here."
        actions={
          <Button variant="secondary" onClick={loadSample}>
            Try the sample file
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <PromptBuilder />
        <ImportBox onSources={startPlan} busy={planning} />
      </div>

      {loadError && <p className="mt-4 text-sm text-rose-600">{loadError}</p>}

      <div ref={previewRef} className="scroll-mt-20">
        {outcome && (
          <Card className="mt-6 border-emerald-200 p-5 dark:border-emerald-900">
            <div className="flex items-start gap-3">
              <PartyPopper className="h-6 w-6 shrink-0 text-emerald-600" />
              <div className="flex-1">
                <h2 className="text-lg font-semibold">Imported</h2>
                <p className="mt-1 text-slate-700 dark:text-slate-300">
                  {outcome.added} new · {outcome.overwritten} overwritten · {outcome.keptBoth} kept both · {outcome.skipped} skipped
                  {outcome.invalid ? ` · ${outcome.invalid} invalid` : ''} · {outcome.lectureIds.length} lectures saved
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {outcome.qids.length > 0 && <Button onClick={quizOnImported}>Quiz me on these {outcome.qids.length}</Button>}
                  <Button variant="secondary" onClick={() => navigate('/quiz/new')}>
                    Build a quiz
                  </Button>
                  <Button variant="ghost" onClick={() => setOutcome(null)}>
                    Import more
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {plan && !outcome && (
          <div className="mt-6">
            <ImportPreview
              plan={plan}
              onCancel={() => setPlan(null)}
              onDone={(o) => {
                setPlan(null);
                setOutcome(o);
                // Ask the browser not to evict the bank under storage pressure.
                void navigator.storage?.persist?.();
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ImportBox({ onSources, busy }: { onSources: (s: ImportSource[]) => void; busy: boolean }) {
  const [drag, setDrag] = useState(false);
  const [tab, setTab] = useState<'file' | 'paste'>('file');
  const [pasted, setPasted] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function readFiles(list: FileList | null) {
    if (!list?.length) return;
    const files = await Promise.all([...list].map(async (f) => ({ name: f.name, text: await f.text() })));
    onSources(files);
  }

  return (
    <Card className="p-5">
      <SectionTitle hint="Drop one or more day files. Valid questions import even if some fail; you'll review duplicates first.">
        2 · Import
      </SectionTitle>
      <div className="mb-3 inline-flex rounded-lg bg-slate-100 p-1 text-sm dark:bg-slate-800">
        {(['file', 'paste'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'rounded-md px-3 py-1 font-medium',
              tab === t ? 'bg-white shadow-sm dark:bg-slate-950' : 'text-slate-600 dark:text-slate-400',
            )}
          >
            {t === 'file' ? 'Upload files' : 'Paste JSON'}
          </button>
        ))}
      </div>

      {tab === 'file' ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void readFiles(e.dataTransfer.files);
          }}
          className={cn(
            'flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors',
            drag ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-slate-300 dark:border-slate-700',
          )}
        >
          <Upload className="mb-2 h-8 w-8 text-slate-400" />
          <p className="font-medium">Drag & drop .json files here</p>
          <p className="mb-3 text-sm text-slate-500">or</p>
          <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
            Choose files
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json,text/plain"
            multiple
            className="hidden"
            onChange={(e) => {
              void readFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      ) : (
        <div>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={10}
            spellCheck={false}
            placeholder={'Paste Claude\'s output here. Code fences (```json) and surrounding chat text are stripped automatically.'}
            className={cn(inputClass, 'font-mono text-xs')}
          />
          <div className="mt-2 flex gap-2">
            <Button onClick={() => onSources([{ name: 'Pasted JSON', text: pasted }])} disabled={!pasted.trim() || busy}>
              <ClipboardPaste className="h-4 w-4" /> Validate
            </Button>
            {pasted && (
              <Button variant="ghost" onClick={() => setPasted('')}>
                Clear
              </Button>
            )}
          </div>
        </div>
      )}
      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
        Format reference:{' '}
        <a className="underline" href={`${import.meta.env.BASE_URL}qbank-schema.json`} target="_blank" rel="noreferrer">
          qbank-schema.json
        </a>
      </p>
    </Card>
  );
}

function PromptBuilder() {
  const [form, setForm] = useState<FormState>(loadForm);
  const [copied, setCopied] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    try {
      const { date: _date, ...rest } = form;
      void _date;
      localStorage.setItem(FORM_KEY, JSON.stringify(rest));
    } catch {
      /* ignore */
    }
  }, [form]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (!next.dayLabelEdited && (k === 'week' || k === 'day' || k === 'date')) {
        next.dayLabel = suggestedDayLabel(next.week, next.day, next.date);
      }
      return next;
    });

  // Existing questions for the "avoid duplicates" block.
  const bank = useLiveQuery(async () => {
    const [qs, lectures] = await Promise.all([db.questions.toArray(), db.lectures.toArray()]);
    const lec = new Map(lectures.map((l) => [l.lecture_id, l]));
    return qs.map((q) => ({ qid: q.qid, stem: q.stem, lecture: lec.get(q.lecture_id) }));
  }, []);

  const scoped = useMemo(() => {
    const all = bank ?? [];
    const inCourse = all.filter((x) => x.lecture?.course === form.course.trim());
    return {
      none: [],
      day: inCourse.filter((x) => x.lecture?.date === form.date),
      week: inCourse.filter((x) => String(x.lecture?.week) === form.week.trim()),
      course: inCourse,
    } satisfies Record<Scope, typeof all>;
  }, [bank, form.course, form.date, form.week]);

  const existing = scoped[form.scope]
    .map((x) => `${x.qid} | ${x.stem.replace(/\s+/g, ' ').slice(0, 140)}${x.stem.length > 140 ? '…' : ''}`)
    .join('\n');
  const prompt = buildGeneratorPrompt({ ...form, existing });

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="p-5">
      <SectionTitle hint="Fill in the day, copy the prompt, and paste it into a new Claude chat with your lecture slides attached.">
        1 · Generate in Claude
      </SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2">
          <Field label="Course">
            <input className={inputClass} value={form.course} onChange={(e) => set('course', e.target.value)} placeholder="Block 2" />
          </Field>
        </div>
        <Field label="Code" hint="for IDs">
          <input className={inputClass} value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="B2" />
        </Field>
        <Field label="Date">
          <input type="date" className={inputClass} value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Week">
          <input className={inputClass} inputMode="numeric" value={form.week} onChange={(e) => set('week', e.target.value.replace(/\D/g, ''))} placeholder="6" />
        </Field>
        <Field label="Day">
          <input className={inputClass} inputMode="numeric" value={form.day} onChange={(e) => set('day', e.target.value.replace(/\D/g, ''))} placeholder="1" />
        </Field>
        <div className="col-span-2">
          <Field label="Day label">
            <input
              className={inputClass}
              value={form.dayLabel}
              onChange={(e) => setForm((f) => ({ ...f, dayLabel: e.target.value, dayLabelEdited: e.target.value !== '' }))}
              placeholder="Week 6 – Day 1 (Mon Oct 5)"
            />
          </Field>
        </div>
        <div className="col-span-2 sm:col-span-4">
          <Field label="Lecture lengths (optional)" hint="Used for the 8–15 questions per hour target. Blank = assume 1 hour each.">
            <input
              className={inputClass}
              value={form.lectureNotes}
              onChange={(e) => set('lectureNotes', e.target.value)}
              placeholder="e.g. L1 50 min, L2 50 min, L3 2-hour workshop"
            />
          </Field>
        </div>
        <div className="col-span-2 sm:col-span-4">
          <Field label="Avoid duplicating questions already in my bank from…">
            <select className={inputClass} value={form.scope} onChange={(e) => set('scope', e.target.value as Scope)}>
              <option value="none">Nothing (don't include a list)</option>
              <option value="day">This date ({scoped.day.length})</option>
              <option value="week">This week ({scoped.week.length})</option>
              <option value="course">This whole course ({scoped.course.length})</option>
            </select>
          </Field>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={copy} size="lg">
          {copied ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
          {copied ? 'Copied!' : 'Copy generator prompt'}
        </Button>
        <Button variant="ghost" onClick={() => setShowPrompt((s) => !s)}>
          {showPrompt ? 'Hide' : 'Preview'}
        </Button>
        <Badge tone="neutral" className="ml-auto">
          <Download className="h-3 w-3" /> {fileNameFor(form)}
        </Badge>
      </div>
      {showPrompt && (
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 dark:bg-slate-950 dark:text-slate-300">
          {prompt}
        </pre>
      )}
    </Card>
  );
}
