import { diffWords, type FieldDiff } from '../lib/dedupe';

function Side({ parts, side }: { parts: ReturnType<typeof diffWords>; side: 'before' | 'after' }) {
  return (
    <div className="whitespace-pre-line text-sm leading-relaxed">
      {parts.map((p, i) => {
        if (p.type === 'same') return <span key={i}>{p.text}</span>;
        if (side === 'before' && p.type === 'del')
          return (
            <del key={i} className="rounded bg-rose-100 text-rose-900 decoration-rose-500 dark:bg-rose-950 dark:text-rose-200">
              {p.text}
            </del>
          );
        if (side === 'after' && p.type === 'add')
          return (
            <ins key={i} className="rounded bg-emerald-100 text-emerald-900 no-underline dark:bg-emerald-950 dark:text-emerald-200">
              {p.text}
            </ins>
          );
        return null;
      })}
    </div>
  );
}

export function DiffView({ diffs }: { diffs: FieldDiff[] }) {
  if (!diffs.length) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">No differences in content — only the qid differs.</p>;
  }
  return (
    <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
      <div className="hidden grid-cols-[8rem_1fr_1fr] gap-3 bg-slate-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:grid dark:bg-slate-900/60 dark:text-slate-400">
        <span>Field</span>
        <span>In your bank</span>
        <span>In this file</span>
      </div>
      {diffs.map((d) => {
        const parts = diffWords(d.before, d.after);
        return (
          <div key={d.field} className="grid gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr_1fr] sm:gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{d.field}</span>
            <div>
              <span className="text-xs text-slate-500 sm:hidden">In your bank: </span>
              {d.before ? <Side parts={parts} side="before" /> : <em className="text-sm text-slate-400">empty</em>}
            </div>
            <div>
              <span className="text-xs text-slate-500 sm:hidden">In this file: </span>
              {d.after ? <Side parts={parts} side="after" /> : <em className="text-sm text-slate-400">empty</em>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
