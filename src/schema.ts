/**
 * The import file contract. Everything in the app is built around this.
 *
 * `public/qbank-schema.json` is generated from these Zod schemas
 * (`npm run schema`) and a test keeps the two in sync.
 */
import { z } from 'zod';

export const FORMAT_VERSION = '1.0';

export const QUESTION_TYPES = [
  'clinical_vignette',
  'mechanism',
  'recall',
  'lab_interpretation',
  'image_based',
] as const;

export const QuestionTypeSchema = z.enum(QUESTION_TYPES);

/** Single capital letter: A, B, C... */
export const OptionIdSchema = z
  .string()
  .regex(/^[A-Z]$/, 'must be a single capital letter (A–Z)');

export const OptionSchema = z.object({
  id: OptionIdSchema,
  text: z.string().trim().min(1, 'must not be empty'),
  explanation: z.string().trim().min(1, 'must not be empty — every option needs its own explanation'),
});

export const SourceSchema = z.object({
  // Accept 12 as well as "12-14" — Claude sometimes emits a bare number.
  slides: z.union([z.string(), z.number()]).transform((v) => String(v)),
  objective: z.string().optional(),
});

export const QuestionSchema = z
  .object({
    qid: z.string().trim().min(1, 'must not be empty'),
    lecture_id: z.string().trim().min(1, 'must not be empty'),
    type: QuestionTypeSchema,
    difficulty: z.number().int().min(1).max(5),
    stem: z.string().trim().min(1, 'must not be empty'),
    options: z.array(OptionSchema).min(2, 'needs at least 2 options').max(8, 'at most 8 options'),
    correct_option: OptionIdSchema,
    explanation: z.string().trim().min(1, 'must not be empty'),
    key_takeaway: z.string().trim().min(1, 'must not be empty'),
    source: SourceSchema,
    tags: z.array(z.string().trim().min(1)).default([]),
    image_url: z.string().nullable().optional().default(null),
  })
  .superRefine((q, ctx) => {
    const ids = q.options.map((o) => o.id);
    const seen = new Set<string>();
    ids.forEach((id, i) => {
      if (seen.has(id)) {
        ctx.addIssue({ code: 'custom', path: ['options', i, 'id'], message: `duplicate option id "${id}"` });
      }
      seen.add(id);
    });
    if (!ids.includes(q.correct_option)) {
      ctx.addIssue({
        code: 'custom',
        path: ['correct_option'],
        message: `"${q.correct_option}" is not one of the option ids (${ids.join(', ')})`,
      });
    }
  });

export const LectureSchema = z.object({
  lecture_id: z.string().trim().min(1, 'must not be empty'),
  title: z.string().trim().min(1, 'must not be empty'),
  lecturer: z.string().optional().default(''),
  summary: z.string().optional().default(''),
  learning_objectives: z.array(z.string()).default([]),
});

const envelopeShape = {
  format_version: z.string().regex(/^1\.\d+$/, `must be "${FORMAT_VERSION}"`),
  generated_at: z.string().optional(),
  course: z.string().trim().min(1, 'must not be empty'),
  week: z.number().int().min(0),
  day_label: z.string().trim().min(1, 'must not be empty'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  lectures: z.array(LectureSchema).min(1, 'needs at least one lecture'),
};

/** The full file, as published in public/qbank-schema.json. */
export const QBankFileSchema = z.object({
  ...envelopeShape,
  questions: z.array(QuestionSchema).min(1, 'needs at least one question'),
});

/**
 * Everything except the questions, which are validated one at a time so a
 * single bad question doesn't block the rest of the file.
 */
export const QBankEnvelopeSchema = z.object({
  ...envelopeShape,
  questions: z.array(z.unknown()).min(1, 'needs at least one question'),
});

export type QuestionType = z.infer<typeof QuestionTypeSchema>;
export type Option = z.infer<typeof OptionSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Lecture = z.infer<typeof LectureSchema>;
export type QBankFile = z.infer<typeof QBankFileSchema>;
export type QBankEnvelope = z.infer<typeof QBankEnvelopeSchema>;

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  clinical_vignette: 'Clinical vignette',
  mechanism: 'Mechanism',
  recall: 'Recall',
  lab_interpretation: 'Lab interpretation',
  image_based: 'Image-based',
};

export function buildJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(QBankFileSchema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  return {
    $id: 'qbank-schema.json',
    title: 'Med School Q-Bank import file',
    description:
      'One file per lecture day. Questions are validated individually; correct_option must match one of the option ids.',
    ...schema,
  };
}
