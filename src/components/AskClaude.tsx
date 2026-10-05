import { Check, ClipboardCopy, MessageCircleQuestion } from 'lucide-react';
import { useState } from 'react';
import type { SessionAnswer, StoredLecture, StoredQuestion } from '../db';
import { buildAskPrompt, claudeUrl, QUICK_ASKS } from '../lib/askClaude';
import { Button, Chip, inputClass, Modal } from './ui';

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

/** Opens Claude with this question, your answer, and the explanation already filled in. */
export function AskClaude({
  question,
  lecture,
  order,
  answer,
}: {
  question: StoredQuestion;
  lecture?: StoredLecture;
  order: string[];
  answer: Pick<SessionAnswer, 'chosen' | 'confidence'> | null;
}) {
  // "Why is my answer wrong?" only makes sense after a miss.
  const asks = answer?.chosen && answer.chosen !== question.correct_option ? QUICK_ASKS : QUICK_ASKS.slice(1);
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState(asks[0].text);
  const [copied, setCopied] = useState(false);
  const prompt = buildAskPrompt(question, lecture, order, answer, ask);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 dark:ring-indigo-900 dark:hover:bg-indigo-950"
      >
        <MessageCircleQuestion className="h-4 w-4" /> Ask Claude about this
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Ask Claude about this question">
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">Pick a question or write your own. Claude gets the full question, your answer, and the explanation.</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {asks.map((a) => (
            <Chip key={a.label} selected={ask === a.text} onClick={() => setAsk(a.text)}>
              {a.label}
            </Chip>
          ))}
        </div>
        <textarea rows={3} className={inputClass} value={ask} onChange={(e) => setAsk(e.target.value)} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            disabled={!ask.trim()}
            onClick={async () => {
              await copy(prompt);
              window.open(claudeUrl(prompt), '_blank', 'noopener');
              setOpen(false);
            }}
          >
            <MessageCircleQuestion className="h-4 w-4" /> Open in Claude
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              await copy(prompt);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy prompt'}
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">The prompt is also copied, so if Claude opens with an empty box, just paste.</p>
      </Modal>
    </>
  );
}
