import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildJsonSchema } from '../schema';
import { sample, sampleText } from '../test/fixtures';
import { extractJson, validateQBank, validateText } from './validate';

describe('validateQBank', () => {
  it('accepts the sample file completely', () => {
    const r = validateText(sampleText(), 'sample.json');
    expect(r.ok).toBe(true);
    expect(r.fileErrors).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.questions).toHaveLength(10);
    expect(r.lectures.map((l) => l.lecture_id)).toEqual(['B2-W6-D1-L1', 'B2-W6-D1-L2']);
    expect(r.meta?.day_label).toBe('Week 6 – Day 1 (Mon Oct 5)');
  });

  it('imports the valid questions and reports exactly which field failed on the bad ones', () => {
    const f = sample();
    delete (f.questions[1].options[2] as Partial<(typeof f.questions)[0]['options'][0]>).explanation;
    f.questions[4].correct_option = 'Z';
    (f.questions[6] as unknown as Record<string, unknown>).difficulty = 9;

    const r = validateQBank(f, 'f.json');
    expect(r.ok).toBe(true);
    expect(r.questions).toHaveLength(7);
    expect(r.skipped.map((s) => s.index)).toEqual([1, 4, 6]);

    const [missing, wrongAnswer, tooHard] = r.skipped.map((s) => s.issues[0]);
    expect(missing.where).toBe('Question 2 (B2-W6-D1-L1-Q002)');
    expect(missing.field).toBe('options[2].explanation');
    expect(missing.message).toMatch(/missing/);
    expect(wrongAnswer.field).toBe('correct_option');
    expect(wrongAnswer.message).toMatch(/not one of the option ids/);
    expect(tooHard.field).toBe('difficulty');
    expect(tooHard.message).toMatch(/at most 5.*got 9/);
  });

  it('rejects the whole file when the header is broken', () => {
    const f = sample() as unknown as Record<string, unknown>;
    delete f.day_label;
    f.date = '10/05/2026';
    const r = validateQBank(f, 'f.json');
    expect(r.ok).toBe(false);
    expect(r.questions).toHaveLength(0);
    expect(r.totalQuestions).toBe(10);
    const fields = r.fileErrors.map((e) => e.field);
    expect(fields).toContain('day_label');
    expect(fields).toContain('date');
  });

  it('flags enum values with the allowed list', () => {
    const f = sample();
    (f.questions[0] as unknown as Record<string, unknown>).type = 'vignette';
    const r = validateQBank(f, 'f.json');
    expect(r.skipped[0].issues[0].message).toMatch(/"vignette" is not allowed.*clinical_vignette/);
  });

  it('skips questions pointing at an unknown lecture, unless that lecture is already in the bank', () => {
    const f = sample();
    f.questions[0].lecture_id = 'B2-W5-D3-L1';
    expect(validateQBank(f, 'f.json').skipped[0].issues[0].field).toBe('lecture_id');
    expect(validateQBank(f, 'f.json', new Set(['B2-W5-D3-L1'])).skipped).toEqual([]);
  });

  it('skips a repeated qid within one file', () => {
    const f = sample();
    f.questions[3].qid = f.questions[2].qid;
    const r = validateQBank(f, 'f.json');
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].issues[0].message).toMatch(/more than once/);
  });

  it('accepts numeric slide numbers and fills defaults', () => {
    const f = sample() as unknown as { questions: Record<string, unknown>[] };
    f.questions[0].source = { slides: 12 };
    delete f.questions[0].tags;
    delete f.questions[0].image_url;
    const r = validateQBank(f, 'f.json');
    expect(r.questions[0].source.slides).toBe('12');
    expect(r.questions[0].tags).toEqual([]);
    expect(r.questions[0].image_url).toBeNull();
  });

  it('rejects duplicate option ids', () => {
    const f = sample();
    f.questions[0].options[1].id = 'A';
    const r = validateQBank(f, 'f.json');
    expect(r.skipped[0].issues.some((i) => i.message.includes('duplicate option id'))).toBe(true);
  });
});

describe('extractJson', () => {
  it('strips ```json fences and chatty text', () => {
    const txt = 'Here is your file:\n```json\n{"a": 1}\n```\nLet me know!';
    expect(extractJson(txt).value).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a": 2} hope this helps').value).toEqual({ a: 2 });
  });

  it('explains truncated output', () => {
    const { error } = extractJson('{"questions": [ {"qid": "x"');
    expect(error).toMatch(/cut off/);
  });

  it('reports empty input', () => {
    expect(extractJson('   ').error).toMatch(/empty/);
  });
});

describe('published JSON Schema', () => {
  it('public/qbank-schema.json is in sync with src/schema.ts (run `npm run schema`)', () => {
    const onDisk = JSON.parse(readFileSync(new URL('../../public/qbank-schema.json', import.meta.url), 'utf8'));
    expect(onDisk).toEqual(buildJsonSchema());
  });
});
