import type { SessionAnswer, StoredLecture, StoredQuestion } from '../db';
import { letter } from './selection';

export const QUICK_ASKS = [
  { label: 'Why was I wrong?', text: 'Why is my answer wrong, and what would have to change in the vignette for it to be right?' },
  { label: 'Explain from scratch', text: "Explain the underlying concept from scratch, like I'm seeing it for the first time." },
  { label: 'Step-by-step reasoning', text: 'Walk me through how to reason to the answer step by step from the vignette.' },
  { label: '2 similar questions', text: 'Write me 2 new NBME-style questions testing the same concept from a different angle (answers at the end).' },
  { label: 'Mnemonic', text: 'Give me a mnemonic or framework to remember this.' },
  { label: 'vs. top distractor', text: 'Compare the correct answer with the most tempting distractor in a table.' },
];

/**
 * Everything Claude needs to discuss one question: the stem, the options as
 * they were shown (letters match what you saw), what you picked, and the
 * explanation and source from the bank.
 */
export function buildAskPrompt(
  q: StoredQuestion,
  lecture: StoredLecture | undefined,
  order: string[],
  answer: Pick<SessionAnswer, 'chosen' | 'confidence'> | null,
  ask: string,
): string {
  const byId = new Map(q.options.map((o) => [o.id, o]));
  const shown = order.map((id, i) => {
    const o = byId.get(id)!;
    const tags = [id === q.correct_option ? 'correct' : '', answer?.chosen === id ? 'my answer' : ''].filter(Boolean);
    return `${letter(i)}. ${o.text}${tags.length ? ` [${tags.join(', ')}]` : ''}\n   Explanation given: ${o.explanation}`;
  });
  const correct = letter(order.indexOf(q.correct_option));
  const mine = answer?.chosen ? letter(order.indexOf(answer.chosen)) : null;
  const result = mine
    ? `I chose ${mine}${answer?.confidence ? ` (I felt ${answer.confidence})` : ''}; the correct answer is ${correct}.`
    : `The correct answer is ${correct}.`;
  const source = [lecture?.title && `"${lecture.title}"`, `slides ${q.source.slides}`, q.source.objective && `objective: ${q.source.objective}`]
    .filter(Boolean)
    .join(', ');

  return `I'm a first-year medical student reviewing a USMLE Step 1-style practice question from my lecture ${source}.

QUESTION
${q.stem}

OPTIONS
${shown.join('\n')}

${result}

EXPLANATION FROM MY QUESTION BANK
${q.explanation}

Key takeaway: ${q.key_takeaway}

If anything in the question or explanation looks medically wrong, tell me.

MY QUESTION
${ask.trim()}`;
}

/** claude.ai link that opens a new chat with the prompt filled in. */
export const claudeUrl = (prompt: string) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
