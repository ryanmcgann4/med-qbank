/**
 * Read and add to your bank from this computer, through the same sync repo and
 * code the Claude connector uses (connector/src/bank.ts). Used by the Mac's
 * "Make Q-Bank Questions" Finder action.
 *
 *   npx tsx scripts/qbank-local.ts context --course "Block 2" --week 12 --date 2026-10-19
 *   npx tsx scripts/qbank-local.ts import B2_W12_D1_2026-10-19.json [--dry-run]
 *
 * The repo comes from --repo or QBANK_REPO; the token from GITHUB_TOKEN or `gh auth token`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { commitChange, snapshot, type Env } from '../connector/src/bank';
import { importDay } from '../connector/src/importDay';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { repo: { type: 'string' }, course: { type: 'string' }, week: { type: 'string' }, date: { type: 'string' }, 'dry-run': { type: 'boolean' } },
});
const [command, file] = positionals;
const repo = values.repo ?? process.env.QBANK_REPO;
if (!repo) throw new Error('Pass --repo owner/name (your Q-Bank sync repo) or set QBANK_REPO.');
const token = process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const env = { REPO: repo, GITHUB_TOKEN: token, BRANCH: 'main' } as Env;

if (command === 'context') {
  // What's already in the bank for this day: lecture ids to reuse or number after, and stems to avoid repeating.
  const { data } = await snapshot(env);
  const day = data.lectures.filter((l) => l.course === values.course && (!values.date || l.date === values.date) && (!values.week || l.week === Number(values.week)));
  const ids = new Set(day.map((l) => l.lecture_id));
  console.log(
    JSON.stringify(
      {
        lectures: day.map((l) => ({ lecture_id: l.lecture_id, title: l.importedTitle ?? l.title, day_label: l.day_label })),
        existing_questions: data.questions.filter((q) => ids.has(q.lecture_id)).map((q) => `${q.qid} | ${q.stem.replace(/\s+/g, ' ').slice(0, 140)}`),
        // Every lecture id in the course, so a new lecture's id can't clash with an older one.
        all_lecture_ids: data.lectures.filter((l) => l.course === values.course).map((l) => l.lecture_id),
      },
      null,
      1,
    ),
  );
} else if (command === 'import' && file) {
  const text = readFileSync(file, 'utf8');
  let report: Record<string, unknown> = {};
  const commit = values['dry-run']
    ? (report = importDay(structuredClone((await snapshot(env)).data), text, basename(file), Date.now()).report, null)
    : await commitChange(env, (data) => {
        const r = importDay(data, text, basename(file), Date.now());
        report = r.report;
        return r.change;
      });
  console.log(JSON.stringify({ ...report, saved: !!commit, dryRun: !!values['dry-run'] }, null, 1));
} else {
  console.error('Usage: qbank-local.ts context --course <name> [--week <n>] [--date YYYY-MM-DD] | import <file.json> [--dry-run]');
  process.exit(2);
}
