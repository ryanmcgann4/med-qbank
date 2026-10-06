import { Lightbulb, BookOpen, Eye } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import type { Confidence, SessionAnswer, StoredLecture, StoredQuestion } from '../db';
import { letter } from '../lib/selection';
import { QUESTION_TYPE_LABELS } from '../schema';
import { AskClaude } from './AskClaude';
import { Badge, cn } from './ui';

export const CONFIDENCE_LABEL: Record<Confidence, string> = { sure: 'Sure', unsure: 'Unsure', guess: 'Guess' };

interface Props {
  question: StoredQuestion;
  lecture?: StoredLecture;
  /** Original option ids in display order. */
  order: string[];
  answer: SessionAnswer;
  revealed: boolean;
  interactive: boolean;
  onSelect?: (id: string) => void;
  onToggleStrike?: (id: string) => void;
  /** Library browsing: show the answer without "your answer" framing. */
  browse?: boolean;
  /** Rendered under the explanation once revealed (e.g. edit/report tools). */
  footer?: ReactNode;
  /** In a live quiz: bring the result banner into view when the answer is revealed. */
  scrollOnReveal?: boolean;
  /** Tutor quiz: offer a hint (the explanation) before answering. */
  onHint?: () => void;
}

export function QuestionView({ question: q, lecture, order, answer, revealed, interactive, onSelect, onToggleStrike, browse, footer, scrollOnReveal, onHint }: Props) {
  const byId = new Map(q.options.map((o) => [o.id, o]));
  const correctLetter = letter(order.indexOf(q.correct_option));
  const chosenLetter = answer.chosen ? letter(order.indexOf(answer.chosen)) : null;
  const bannerRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLElement>(null);
  const hintOpen = !revealed && !!answer.hinted;

  useEffect(() => {
    if (revealed && scrollOnReveal) bannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [revealed, scrollOnReveal]);

  useEffect(() => {
    if (hintOpen) hintRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [hintOpen]);

  return (
    <div>
      <p className="whitespace-pre-line text-[17px] leading-relaxed sm:text-lg">{q.stem}</p>
      {q.image_url && <img src={q.image_url} alt="Question figure" className="mt-4 max-h-96 rounded-lg border border-slate-200 dark:border-slate-700" />}

      {revealed && (
        <div
          ref={bannerRef}
          role="status"
          className={cn(
            'mt-5 scroll-mt-32 rounded-xl border-2 px-4 py-3 text-lg font-semibold',
            browse
              ? 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100'
              : answer.correct
                ? 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100'
                : 'border-rose-500 bg-rose-50 text-rose-900 dark:bg-rose-950/60 dark:text-rose-100',
          )}
        >
          {browse ? (
            <>Correct answer: {correctLetter}</>
          ) : answer.correct ? (
            <>✅ Correct answer: {correctLetter}</>
          ) : chosenLetter ? (
            <>
              ❌ Incorrect — Correct answer: {correctLetter}
              <span className="ml-2 text-base font-normal">(you chose {chosenLetter})</span>
            </>
          ) : (
            <>⚪ Not answered — Correct answer: {correctLetter}</>
          )}
          {!browse && answer.confidence && (
            <span className="mt-0.5 block text-sm font-normal opacity-80">
              You marked: {CONFIDENCE_LABEL[answer.confidence]}
              {answer.hinted
                ? ` · used the hint${answer.correct ? ', so this will come back tomorrow' : ''}`
                : answer.correct && answer.confidence === 'guess' && ' — lucky guess, this will come back tomorrow'}
            </span>
          )}
        </div>
      )}

      <div role="radiogroup" aria-label="Answer choices" className="mt-5 space-y-2.5">
        {order.map((id, i) => {
          const o = byId.get(id);
          if (!o) return null;
          return (
            <OptionButton
              key={id}
              label={letter(i)}
              text={o.text}
              explanation={revealed ? o.explanation : undefined}
              selected={answer.chosen === id}
              struck={answer.struck.includes(id)}
              state={!revealed ? 'idle' : id === q.correct_option ? 'correct' : answer.chosen === id ? 'wrong' : 'other'}
              interactive={interactive && !revealed}
              onSelect={() => onSelect?.(id)}
              onToggleStrike={() => onToggleStrike?.(id)}
            />
          );
        })}
      </div>

      {!revealed && (
        <div className="mt-5 space-y-3">
          {hintOpen ? (
            <section ref={hintRef} className="scroll-mt-32 rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900/60 dark:bg-sky-950/30">
              <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-300">Hint</h3>
              <p className="whitespace-pre-line leading-relaxed">{q.explanation}</p>
            </section>
          ) : (
            onHint && (
              <button
                type="button"
                onClick={onHint}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-sky-700 ring-1 ring-inset ring-sky-200 hover:bg-sky-50 dark:text-sky-300 dark:ring-sky-900 dark:hover:bg-sky-950/40"
              >
                <Eye className="h-4 w-4" /> Show hint <span className="hidden font-normal opacity-70 sm:inline">(H)</span>
              </button>
            )
          )}
          <SourceCard question={q} lecture={lecture} />
        </div>
      )}

      {revealed && (
        <div className="mt-6 space-y-4">
          <section>
            <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Explanation</h3>
            <p className="whitespace-pre-line leading-relaxed">{q.explanation}</p>
          </section>

          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
            <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">Key takeaway</div>
              <p className="mt-0.5 font-medium leading-relaxed">{q.key_takeaway}</p>
            </div>
          </div>

          <SourceCard question={q} lecture={lecture} />

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="indigo">{QUESTION_TYPE_LABELS[q.type]}</Badge>
            <Badge>Difficulty {q.difficulty}/5</Badge>
            {q.tags.map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
            {q.editedAt && <Badge tone="amber">edited</Badge>}
            <code className="ml-auto text-xs text-slate-400">{q.qid}</code>
          </div>
          <div>
            <AskClaude question={q} lecture={lecture} order={order} answer={browse ? null : answer} />
          </div>
          {footer}
        </div>
      )}
    </div>
  );
}

/** Where the question comes from in the slides. */
function SourceCard({ question: q, lecture }: { question: StoredQuestion; lecture?: StoredLecture }) {
  return (
    <div className="flex gap-3 rounded-xl bg-slate-100 p-4 text-sm dark:bg-slate-800/60">
      <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
      <div className="space-y-0.5">
        <div>
          <span className="font-semibold">{lecture?.title ?? q.lecture_id}</span>
          {lecture?.lecturer && <span className="text-slate-600 dark:text-slate-400"> · {lecture.lecturer}</span>}
        </div>
        <div className="text-slate-700 dark:text-slate-300">
          Slides {q.source.slides}
          {lecture && ` · ${lecture.day_label}`}
        </div>
        {q.source.objective && <div className="text-slate-600 dark:text-slate-400">Objective: {q.source.objective}</div>}
      </div>
    </div>
  );
}

type OptionState = 'idle' | 'correct' | 'wrong' | 'other';

function OptionButton({
  label,
  text,
  explanation,
  selected,
  struck,
  state,
  interactive,
  onSelect,
  onToggleStrike,
}: {
  label: string;
  text: string;
  explanation?: string;
  selected: boolean;
  struck: boolean;
  state: OptionState;
  interactive: boolean;
  onSelect: () => void;
  onToggleStrike: () => void;
}) {
  // Long-press (touch) or right-click toggles strikethrough, like UWorld.
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const strike = () => {
    if (fired.current) return;
    fired.current = true;
    onToggleStrike();
    navigator.vibrate?.(10);
  };

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={!interactive}
      onPointerDown={(e) => {
        fired.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        if (interactive && e.pointerType !== 'mouse') timer.current = window.setTimeout(strike, 450);
      }}
      onPointerMove={(e) => {
        // A finger that moves is scrolling or swiping, not long-pressing.
        if (timer.current !== null && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clear();
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => {
        if (!interactive) return;
        e.preventDefault();
        clear();
        strike();
      }}
      onClick={() => {
        if (fired.current) {
          fired.current = false;
          return;
        }
        if (interactive) onSelect();
      }}
      style={{ WebkitTouchCallout: 'none' }}
      className={cn(
        'group flex w-full select-none items-start gap-3 rounded-xl border-2 px-3 py-3 text-left transition-colors sm:px-4',
        interactive ? 'cursor-pointer' : 'cursor-default',
        state === 'idle' &&
          (selected
            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50'
            : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'),
        state === 'correct' && 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40',
        state === 'wrong' && 'border-rose-500 bg-rose-50 dark:bg-rose-950/40',
        state === 'other' && 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
      )}
    >
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
          state === 'correct'
            ? 'bg-emerald-600 text-white'
            : state === 'wrong'
              ? 'bg-rose-600 text-white'
              : selected
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
        )}
      >
        {label}
      </span>
      <span className="min-w-0 flex-1 pt-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn('text-[16px] leading-snug sm:text-[17px]', struck && 'text-slate-400 line-through decoration-2 dark:text-slate-500')}>
            {text}
          </span>
          {state === 'correct' && (
            <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">✓ Correct answer{selected ? ' — your answer' : ''}</span>
          )}
          {state === 'wrong' && <span className="text-sm font-semibold text-rose-700 dark:text-rose-400">✗ Your answer</span>}
        </span>
        {explanation && <span className="mt-1.5 block text-sm leading-relaxed text-slate-700 dark:text-slate-300">{explanation}</span>}
      </span>
    </button>
  );
}
