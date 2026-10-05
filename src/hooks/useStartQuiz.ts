import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { QuizConfig } from '../db';
import { defaultConfig } from '../lib/selection';
import { createQuiz } from '../lib/tracking';

/** Start a quiz and open it; reports when nothing matched. */
export function useStartQuiz() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function start(over: Partial<QuizConfig>, title?: string) {
    setBusy(true);
    setMessage(null);
    const s = await createQuiz({ ...defaultConfig(), ...over }, title);
    setBusy(false);
    if (s) navigate(`/quiz/${s.id}`);
    else setMessage('No questions match — they may all have been answered correctly in the last few days.');
  }

  return { start, busy, message };
}
