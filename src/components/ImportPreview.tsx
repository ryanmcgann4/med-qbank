import { AlertTriangle, CheckCircle2, ChevronRight, FileJson, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { allowedResolutions, diffQuestion, type MatchKind, type Resolution } from '../lib/dedupe';
import type { ImportOutcome, ImportPlan, PlanItem } from '../lib/importer';
import { applyImport } from '../lib/importer';
import { Badge, Button, Card, cn } from './ui';
import { DiffView } from './DiffView';
import { formatDate } from '../lib/dates';

const RESOLUTION_LABEL: Record<Resolution, string> = {
  add: 'Add',
  skip: 'Skip',
  overwrite: 'Overwrite (keeps my progress)',
  keep_both: 'Keep both',
};

const KIND_LABEL: Record<MatchKind, string> = {
  new: 'New',
  identical: 'Already in bank',
  qid_conflict: 'Same qid, different content',
  content_duplicate: 'Same question, different qid',
  batch_duplicate: 'Repeated in this import',
};

export function ImportPreview({
  plan,
  onDone,
  onCancel,
}: {
  plan: ImportPlan;
  onDone: (o: ImportOutcome) => void;
  onCancel: () => void;
}) {
  const [res, setRes] = useState<Record<string, Resolution>>(() => Object.fromEntries(plan.items.map((i) => [i.key, i.resolution])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conflicts = plan.items.filter((i) => i.kind === 'qid_conflict' || i.kind === 'content_duplicate');
  const fresh = plan.items.filter((i) => i.kind === 'new');
  const repeats = plan.items.filter((i) => i.kind === 'identical' || i.kind === 'batch_duplicate');
  const invalid = plan.files.reduce((n, f) => n + f.skipped.length + (f.ok ? 0 : f.totalQuestions), 0);

  const counts = useMemo(() => {
    const c = { add: 0, overwrite: 0, keep_both: 0, skip: 0 };
    for (const i of plan.items) c[res[i.key]]++;
    return c;
  }, [plan.items, res]);
  const writes = counts.add + counts.overwrite + counts.keep_both;
  const newLectures = plan.lectures.filter((l) => l.isNew).length;

  const setAll = (r: Resolution) => setRes((prev) => ({ ...prev, ...Object.fromEntries(conflicts.map((c) => [c.key, r])) }));

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      onDone(await applyImport(plan, res));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <h2 className="text-lg font-semibold">Import summary</h2>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone="green">{fresh.length} new questions</Badge>
            <Badge tone="indigo">
              {plan.lectures.length} lectures{newLectures ? ` (${newLectures} new)` : ''}
            </Badge>
            <Badge tone={conflicts.length ? 'amber' : 'neutral'}>{conflicts.length} need a decision</Badge>
            <Badge tone="neutral">{repeats.length} duplicates skipped</Badge>
            <Badge tone={invalid ? 'red' : 'neutral'}>{invalid} invalid</Badge>
          </div>
        </div>
      </Card>

      {plan.files.map((f, fi) => (
        <Card key={fi} className="p-4">
          <div className="flex flex-wrap items-start gap-3">
            <FileJson className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all font-medium">{f.name}</span>
                {f.ok ? (
                  <Badge tone={f.skipped.length ? 'amber' : 'green'}>
                    {f.questions.length}/{f.totalQuestions} questions valid
                  </Badge>
                ) : (
                  <Badge tone="red">Can't import this file</Badge>
                )}
              </div>
              {f.meta && (
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{f.meta.day_label}</span> · {f.meta.course} · Week{' '}
                  {f.meta.week} · {formatDate(f.meta.date)}
                </div>
              )}
            </div>
          </div>

          {f.fileErrors.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-lg bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
              {f.fileErrors.map((e, i) => (
                <li key={i} className="flex gap-2">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {e.field !== '(root)' && <code className="font-semibold">{e.field}</code>} {e.message}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {plan.lectures.some((l) => l.fileIndex === fi) && (
            <div className="mt-3 space-y-2">
              {plan.lectures
                .filter((l) => l.fileIndex === fi)
                .map(({ lecture: l, isNew }) => (
                  <details key={l.lecture_id} className="group rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                    <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
                      <span className="font-medium">{l.title}</span>
                      {l.lecturer && <span className="text-slate-500 dark:text-slate-400">· {l.lecturer}</span>}
                      <span className="ml-auto flex shrink-0 gap-1.5">
                        <Badge>{f.questions.filter((q) => q.lecture_id === l.lecture_id).length} Qs</Badge>
                        {!isNew && <Badge tone="sky">updates existing</Badge>}
                      </span>
                    </summary>
                    <div className="mt-2 space-y-2 pl-6 text-sm text-slate-700 dark:text-slate-300">
                      {l.summary && <p>{l.summary}</p>}
                      {l.learning_objectives.length > 0 && (
                        <ul className="list-disc space-y-0.5 pl-4">
                          {l.learning_objectives.map((o, i) => (
                            <li key={i}>{o}</li>
                          ))}
                        </ul>
                      )}
                      <p className="text-xs text-slate-500">{l.lecture_id}</p>
                    </div>
                  </details>
                ))}
            </div>
          )}

          {f.skipped.length > 0 && (
            <details className="mt-3 rounded-lg bg-rose-50 p-3 text-sm dark:bg-rose-950/40" open={f.skipped.length <= 5}>
              <summary className="cursor-pointer font-medium text-rose-900 dark:text-rose-200">
                {f.skipped.length} question{f.skipped.length === 1 ? '' : 's'} skipped because of errors
              </summary>
              <ul className="mt-2 space-y-2">
                {f.skipped.map((s) => (
                  <li key={s.index}>
                    <div className="font-medium text-rose-900 dark:text-rose-200">{s.issues[0]?.where}</div>
                    <ul className="ml-4 list-disc text-rose-800 dark:text-rose-300">
                      {s.issues.map((e, i) => (
                        <li key={i}>
                          <code className="font-semibold">{e.field}</code> {e.message}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {f.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-amber-800 dark:text-amber-300">
              {f.warnings.map((w, i) => (
                <li key={i} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}

      {conflicts.length > 0 && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">Possible duplicates ({conflicts.length})</h3>
            <span className="text-sm text-slate-600 dark:text-slate-400">Skipped unless you choose otherwise. Your progress is never wiped.</span>
            <div className="ml-auto flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setAll('skip')}>
                Skip all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAll('overwrite')}>
                Overwrite all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAll('keep_both')}>
                Keep all
              </Button>
            </div>
          </div>
          <div className="space-y-4">
            {conflicts.map((c) => (
              <ConflictRow key={c.key} item={c} value={res[c.key]} onChange={(r) => setRes((p) => ({ ...p, [c.key]: r }))} />
            ))}
          </div>
        </Card>
      )}

      {(fresh.length > 0 || repeats.length > 0) && (
        <Card className="p-4 text-sm">
          {fresh.length > 0 && (
            <details>
              <summary className="cursor-pointer font-medium">{fresh.length} new questions</summary>
              <ul className="mt-2 space-y-1.5">
                {fresh.map((i) => (
                  <li key={i.key} className="flex gap-2">
                    <label className="flex flex-1 cursor-pointer gap-2">
                      <input
                        type="checkbox"
                        className="mt-1 accent-indigo-600"
                        checked={res[i.key] === 'add'}
                        onChange={(e) => setRes((p) => ({ ...p, [i.key]: e.target.checked ? 'add' : 'skip' }))}
                      />
                      <span>
                        <code className="text-xs text-slate-500">{i.question.qid}</code>{' '}
                        <span className="line-clamp-2">{i.question.stem}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {repeats.length > 0 && (
            <details className={cn(fresh.length > 0 && 'mt-3')}>
              <summary className="cursor-pointer font-medium text-slate-600 dark:text-slate-400">
                {repeats.length} already in your bank or repeated in this import (skipped)
              </summary>
              <ul className="mt-2 space-y-1 text-slate-600 dark:text-slate-400">
                {repeats.map((i) => (
                  <li key={i.key}>
                    <code className="text-xs">{i.question.qid}</code> — {KIND_LABEL[i.kind]}
                    {i.dupOf && i.dupOf !== i.question.qid ? ` (same as ${i.dupOf})` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>
      )}

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="sticky bottom-20 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:bottom-4 dark:border-slate-800 dark:bg-slate-900/95">
        <span className="text-sm text-slate-600 dark:text-slate-400">
          {counts.add} add · {counts.overwrite} overwrite · {counts.keep_both} keep both · {counts.skip} skip
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={commit} disabled={busy || (writes === 0 && plan.lectures.length === 0)}>
            <CheckCircle2 className="h-4 w-4" />
            {writes ? `Import ${writes} question${writes === 1 ? '' : 's'}` : 'Save lectures only'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConflictRow({ item, value, onChange }: { item: PlanItem; value: Resolution; onChange: (r: Resolution) => void }) {
  const diffs = useMemo(() => (item.existing ? diffQuestion(item.existing, item.question) : []), [item]);
  return (
    <div className="rounded-lg border border-amber-200 p-3 dark:border-amber-900/60">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="amber">{KIND_LABEL[item.kind]}</Badge>
        <code className="text-xs">{item.question.qid}</code>
        {item.existing && item.existing.qid !== item.question.qid && (
          <span className="text-xs text-slate-500">
            matches <code>{item.existing.qid}</code>
          </span>
        )}
      </div>
      {item.existing?.editedAt && (
        <p className="mb-2 flex gap-1.5 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          You edited this question in the app. Overwriting replaces your edits (your answer history stays).
        </p>
      )}
      <DiffView diffs={diffs} />
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup">
        {allowedResolutions(item.kind).map((r) => (
          <label
            key={r}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm ring-1 ring-inset',
              value === r ? 'bg-indigo-50 ring-indigo-500 dark:bg-indigo-950' : 'ring-slate-300 dark:ring-slate-700',
            )}
          >
            <input type="radio" className="accent-indigo-600" checked={value === r} onChange={() => onChange(r)} />
            {RESOLUTION_LABEL[r]}
          </label>
        ))}
      </div>
    </div>
  );
}
