import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sample, SAMPLE_PATH } from '../test/fixtures';

const VALIDATOR = new URL('../../claude-skill/qbank-generator/scripts/validate_qbank.py', import.meta.url).pathname;

function validate(path: string): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('python3', [VALIDATOR, path], { encoding: 'utf8' }) };
  } catch (e) {
    const err = e as { status: number; stdout: string };
    return { code: err.status, out: err.stdout };
  }
}

describe('Claude skill validator', () => {
  it('passes the sample file', () => {
    const r = validate(SAMPLE_PATH.pathname);
    expect(r.code).toBe(0);
    expect(r.out).toContain('0 errors');
  });

  it('catches what breaks the app: letter references, wrong option count, bad key, negative stems', () => {
    const f = sample();
    f.questions[0].explanation += ' Option B is wrong because it is SGLT1.';
    f.questions[1].options = f.questions[1].options.slice(0, 4);
    f.questions[2].correct_option = 'Z';
    f.questions[3].stem = 'Which of the following is NOT true?';
    const path = join(tmpdir(), `qbank-bad-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify(f));
    const r = validate(path);
    expect(r.code).toBe(1);
    expect(r.out).toContain('refers to an option by letter');
    expect(r.out).toContain('exactly 5 with ids A-E');
    expect(r.out).toContain('correct_option "Z"');
    expect(r.out).toContain('negatively phrased stem');
  });

  it('SKILL.md has valid frontmatter', () => {
    const md = readFileSync(new URL('../../claude-skill/qbank-generator/SKILL.md', import.meta.url), 'utf8');
    const fm = md.match(/^---\nname: ([a-z0-9-]+)\ndescription: (.+)\n---\n/);
    expect(fm?.[1]).toBe('qbank-generator');
    expect(fm![2].length).toBeLessThan(1024);
  });
});
