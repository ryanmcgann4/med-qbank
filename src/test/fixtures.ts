import { readFileSync } from 'node:fs';
import type { QBankFile, Question } from '../schema';

export const SAMPLE_PATH = new URL('../../public/sample/B2_W6_D1_2026-10-05.json', import.meta.url);
export const sampleText = () => readFileSync(SAMPLE_PATH, 'utf8');
export const sample = (): QBankFile => JSON.parse(sampleText());

export function makeQuestion(over: Partial<Question> = {}): Question {
  return {
    qid: 'T-W1-D1-L1-Q001',
    lecture_id: 'T-W1-D1-L1',
    type: 'recall',
    difficulty: 2,
    stem: 'Which ion is mostly reabsorbed in the PCT?',
    options: [
      { id: 'A', text: 'Sodium', explanation: 'yes' },
      { id: 'B', text: 'Calcium', explanation: 'no' },
      { id: 'C', text: 'Magnesium', explanation: 'no' },
    ],
    correct_option: 'A',
    explanation: 'Because.',
    key_takeaway: 'Na in PCT.',
    source: { slides: '1' },
    tags: ['renal'],
    image_url: null,
    ...over,
  };
}
