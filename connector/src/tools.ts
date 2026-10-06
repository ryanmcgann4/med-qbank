import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Confidence, Progress, StatusKey, StoredLecture, StoredQuestion } from '../../src/db';
import { classifyQuestions } from '../../src/lib/dedupe';
import { planFor, upcoming } from '../../src/lib/exams';
import { contentHash } from '../../src/lib/hash';
import { autoNames } from '../../src/lib/org';
import { emptyProgress } from '../../src/lib/progress';
import { defaultConfig, emptyFilters, selectQuestions, weekKey, type Candidate } from '../../src/lib/selection';
import { byLecture, byTag, statusCounts, weakest } from '../../src/lib/stats';
import { statusesOf } from '../../src/lib/status';
import { validateText } from '../../src/lib/validate';
import { commitChange, dayIn, snapshot, withProgress, type Env } from './bank';

const INSTRUCTIONS = `Q-Bank is the user's personal bank of USMLE Step 1-style practice questions, synced to their phone and laptop.

Quizzing in chat: call qbank_quiz_start, then show ONE question at a time (stem and options A-E) without revealing the answer. Ask for their answer and how sure they are (sure / unsure / guess). Then call qbank_answer, which records it in their bank and returns the correct answer and every option's explanation; share the result, the explanation of why each wrong option is wrong, and the key takeaway, then move to the next question.

Adding questions: when you've written a Q-Bank day file (e.g. with the qbank-generator skill), call qbank_import with the JSON. Use qbank_existing_questions first to avoid duplicates.`;

const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));

async function load(env: Env) {
  const snap = await snapshot(env);
  const data = withProgress(snap.data);
  const lectures = new Map(data.lectures.map((l) => [l.lecture_id, l]));
  const progress = new Map(data.progress.map((p) => [p.qid, p]));
  const all: Candidate[] = data.questions.map((q) => ({ q, lecture: lectures.get(q.lecture_id), progress: progress.get(q.qid) }));
  const active = all.filter((c) => !c.progress?.archived);
  return { snap, data, lectures, all, active, names: autoNames(data.folders ?? []) };
}

const preview = (c: Candidate, now: number) => ({
  qid: c.q.qid,
  lecture: c.lecture?.title ?? c.q.lecture_id,
  stem: c.q.stem.length > 220 ? c.q.stem.slice(0, 220) + '…' : c.q.stem,
  status: statusesOf(c.progress, now),
  record: c.progress?.timesSeen ? `${c.progress.timesCorrect}/${c.progress.timesSeen} correct` : 'unseen',
});

const asked = (q: StoredQuestion, l?: StoredLecture) => ({
  qid: q.qid,
  lecture: l?.title ?? q.lecture_id,
  type: q.type,
  stem: q.stem,
  options: q.options.map((o) => ({ id: o.id, text: o.text })),
});

export function buildServer(env: Env): McpServer {
  const server = new McpServer({ name: 'qbank', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const read = { readOnlyHint: true, openWorldHint: false };
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

  server.registerTool(
    'qbank_overview',
    {
      title: 'Q-Bank overview',
      description: 'Bank totals, what is due today, accuracy, upcoming exams with today’s plan, and the weakest lectures and topics.',
      annotations: read,
    },
    async () => {
      const { data, active } = await load(env);
      const now = Date.now();
      const counts = statusCounts(active, now);
      const answers = data.attempts.length;
      const right = data.attempts.filter((a) => a.correct).length;
      const week = data.attempts.filter((a) => a.ts > now - 7 * 864e5);
      return json({
        questions: active.length,
        due_today: counts.due,
        unseen: counts.unseen,
        missed_last_time: counts.missed,
        flagged: counts.flagged,
        mastered: counts.mastered,
        overall_accuracy: pct(answers ? right / answers : null),
        last_7_days: { answers: week.length, accuracy: pct(week.length ? week.filter((a) => a.correct).length / week.length : null) },
        upcoming_exams: upcoming(data.exams ?? [], now).map((e) => {
          const p = planFor(e, active, data.attempts, now);
          return { name: e.name, date: e.date, days_left: p.daysLeft, today: { new: `${p.newDone}/${p.newTarget}`, reviews: `${p.reviewDone}/${p.reviewTarget}` }, seen: `${p.seen}/${p.total}` };
        }),
        weakest_lectures: weakest(byLecture(active)).map((a) => ({ lecture_id: a.key, title: a.label, accuracy: pct(a.accuracy), answers: a.attempts })),
        weakest_tags: weakest(byTag(active)).map((a) => ({ tag: a.key, accuracy: pct(a.accuracy), answers: a.attempts })),
      });
    },
  );

  server.registerTool(
    'qbank_list_lectures',
    {
      title: 'List lectures',
      description: 'Lectures in the bank grouped by course, week and day, with question counts and accuracy. Use the lecture_ids to quiz or search.',
      inputSchema: { course: z.string().optional().describe('Filter by course, e.g. "Block 2"'), week: z.number().int().optional() },
      annotations: read,
    },
    async ({ course, week }) => {
      const { data, active, names } = await load(env);
      const stats = new Map(byLecture(active).map((a) => [a.key, a]));
      const rows = data.lectures
        .filter((l) => (!course || l.course === course) && (week === undefined || l.week === week))
        .sort((a, b) => a.date.localeCompare(b.date) || a.lecture_id.localeCompare(b.lecture_id))
        .map((l) => {
          const s = stats.get(l.lecture_id);
          return {
            lecture_id: l.lecture_id,
            title: l.title,
            course: names.course(l.course),
            week: names.week(l.course, l.week),
            day: names.day(l.course, l.day_label),
            questions: s?.questions ?? 0,
            seen: s?.seenQuestions ?? 0,
            accuracy: pct(s?.accuracy ?? null),
          };
        });
      return json(rows);
    },
  );

  server.registerTool(
    'qbank_search',
    {
      title: 'Search questions',
      description: 'Full-text search across stems, options, explanations, tags and lecture titles. Returns previews; use qbank_get_questions for full content.',
      inputSchema: { query: z.string().min(2), limit: z.number().int().min(1).max(50).default(10) },
      annotations: read,
    },
    async ({ query, limit }) => {
      const { active } = await load(env);
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const now = Date.now();
      const hits = active.filter((c) => {
        const h = [c.q.qid, c.q.stem, ...c.q.options.flatMap((o) => [o.text, o.explanation]), c.q.explanation, c.q.key_takeaway, ...c.q.tags, c.lecture?.title ?? '']
          .join(' ')
          .toLowerCase();
        return terms.every((t) => h.includes(t));
      });
      return json({ total: hits.length, results: hits.slice(0, limit).map((c) => preview(c, now)) });
    },
  );

  server.registerTool(
    'qbank_get_questions',
    {
      title: 'Get full questions',
      description: 'Full questions with answers, every option’s explanation, source slides, and the user’s record. Do not use this to quiz (it reveals answers); use qbank_quiz_start.',
      inputSchema: { qids: z.array(z.string()).min(1).max(25) },
      annotations: read,
    },
    async ({ qids }) => {
      const { all } = await load(env);
      const now = Date.now();
      const byId = new Map(all.map((c) => [c.q.qid, c]));
      return json(
        qids.map((id) => {
          const c = byId.get(id);
          if (!c) return { qid: id, error: 'not found' };
          return { ...c.q, hash: undefined, lecture: c.lecture?.title, status: statusesOf(c.progress, now), note: c.progress?.note || undefined };
        }),
      );
    },
  );

  server.registerTool(
    'qbank_existing_questions',
    {
      title: 'Existing questions (for avoiding duplicates)',
      description: 'One line per existing question ("qid | stem…") for a course, week or date, to avoid duplicating them when writing new ones.',
      inputSchema: { course: z.string().optional(), week: z.number().int().optional(), date: z.string().optional().describe('YYYY-MM-DD') },
      annotations: read,
    },
    async ({ course, week, date }) => {
      const { all } = await load(env);
      const lines = all
        .filter((c) => c.lecture && (!course || c.lecture.course === course) && (week === undefined || c.lecture.week === week) && (!date || c.lecture.date === date))
        .map((c) => `${c.q.qid} | ${c.q.stem.replace(/\s+/g, ' ').slice(0, 140)}`);
      return text(lines.length ? lines.join('\n') : 'No questions match.');
    },
  );

  server.registerTool(
    'qbank_import',
    {
      title: 'Import a day file',
      description:
        'Add a Q-Bank day file (the JSON format from the qbank-generator skill) to the bank. New questions are added; exact repeats are skipped; questions that clash with existing ones are reported, not overwritten. The user’s devices pick them up on their next sync.',
      inputSchema: { file_json: z.string().describe('The complete day file as JSON text'), file_name: z.string().optional() },
      annotations: write,
    },
    async ({ file_json, file_name }) => {
      let report: Record<string, unknown> = {};
      const now = Date.now();
      const commit = await commitChange(env, (data) => {
        const known = new Set(data.lectures.map((l) => l.lecture_id));
        const v = validateText(file_json, file_name ?? 'from Claude', known);
        if (!v.ok || !v.meta) {
          report = { imported: 0, errors: v.fileErrors.map((e) => `${e.field}: ${e.message}`) };
          return null;
        }
        const classified = classifyQuestions(
          v.questions.map((question) => ({ question, fileIndex: 0 })),
          data.questions,
        );
        const added = classified.filter((c) => c.kind === 'new');
        report = {
          day: v.meta.day_label,
          imported: added.length,
          already_in_bank: classified.filter((c) => c.kind === 'identical' || c.kind === 'batch_duplicate').length,
          conflicts: classified
            .filter((c) => c.kind === 'qid_conflict' || c.kind === 'content_duplicate')
            .map((c) => `${c.question.qid}: ${c.kind === 'qid_conflict' ? 'same qid, different content' : `same question as ${c.existing?.qid}`} (resolve by importing the file in the app)`),
          invalid: v.skipped.map((s) => `${s.issues[0]?.where}: ${s.issues.map((i) => `${i.field} ${i.message}`).join('; ')}`),
          warnings: v.warnings,
        };
        const meta = v.meta;
        for (const l of v.lectures) {
          const prev = data.lectures.find((x) => x.lecture_id === l.lecture_id);
          const fresh: StoredLecture = {
            ...l,
            course: meta.course,
            week: meta.week,
            day_label: meta.day_label,
            date: meta.date,
            importedAt: prev?.importedAt ?? now,
            folderId: prev?.folderId,
            movedAt: prev?.movedAt,
            ...(prev?.renamedAt ? { title: prev.title, renamedAt: prev.renamedAt, importedTitle: l.title } : {}),
          };
          data.lectures = [...data.lectures.filter((x) => x.lecture_id !== l.lecture_id), fresh];
        }
        for (const c of added) data.questions.push({ ...c.question, hash: contentHash(c.question), importedAt: now, updatedAt: now, editedAt: null });
        data.imports.push({
          importedAt: now,
          files: [{ name: file_name ?? 'from Claude', day_label: meta.day_label, course: meta.course, week: meta.week, date: meta.date }],
          lectureIds: v.lectures.map((l) => l.lecture_id),
          added: added.length,
          overwritten: 0,
          keptBoth: 0,
          skipped: classified.length - added.length,
          invalid: v.skipped.length,
        });
        return { data, message: `Import ${meta.day_label} from Claude (${added.length} questions)` };
      });
      return json({ ...report, saved: !!commit });
    },
  );

  server.registerTool(
    'qbank_quiz_start',
    {
      title: 'Start a quiz',
      description:
        'Pick questions to quiz the user on, WITHOUT answers. Show them one at a time; after the user answers, call qbank_answer. Focus: smart (due → missed → unseen), due, missed, unseen, weak (weighted to weak spots), flagged.',
      inputSchema: {
        count: z.number().int().min(1).max(40).default(5),
        focus: z.enum(['smart', 'due', 'missed', 'unseen', 'weak', 'flagged']).default('smart'),
        lecture_ids: z.array(z.string()).optional(),
        course: z.string().optional(),
        week: z.number().int().optional(),
        tags: z.array(z.string()).optional(),
      },
      annotations: read,
    },
    async ({ count, focus, lecture_ids, course, week, tags }) => {
      const { active, lectures } = await load(env);
      const filters = {
        ...emptyFilters(),
        lectures: lecture_ids ?? [],
        courses: course ? [course] : [],
        weeks: course && week !== undefined ? [weekKey(course, week)] : [],
        tags: tags ?? [],
        statuses: (focus === 'due' ? ['due'] : focus === 'flagged' ? ['flagged'] : []) as StatusKey[],
      };
      const pool = week !== undefined && !course ? active.filter((c) => c.lecture?.week === week) : active;
      const mode = focus === 'missed' ? 'missed' : focus === 'unseen' ? 'unseen' : focus === 'weak' ? 'weekly' : 'smart';
      const picked = selectQuestions(pool, { ...defaultConfig(), mode, count, filters }, Date.now());
      if (!picked.length) return text('No questions match (they may all have been answered correctly in the last few days). Try another focus.');
      return json({ questions: picked.map((c) => asked(c.q, lectures.get(c.q.lecture_id))) });
    },
  );

  server.registerTool(
    'qbank_answer',
    {
      title: 'Record an answer',
      description: 'Record the user’s answer to a question (it counts in their bank and spaced-repetition schedule) and get the correct answer with every option’s explanation.',
      inputSchema: {
        qid: z.string(),
        choice: z.string().regex(/^[A-Ha-h]$/).describe('The option letter the user chose'),
        confidence: z.enum(['sure', 'unsure', 'guess']).optional(),
        seconds: z.number().min(0).optional(),
      },
      annotations: write,
    },
    async ({ qid, choice, confidence, seconds }) => {
      const now = Date.now();
      let result: unknown = null;
      await commitChange(env, (data) => {
        const q = data.questions.find((x) => x.qid === qid);
        if (!q) {
          result = { error: `No question ${qid}` };
          return null;
        }
        const chosen = choice.toUpperCase();
        const correct = chosen === q.correct_option;
        const l = data.lectures.find((x) => x.lecture_id === q.lecture_id);
        result = {
          correct,
          your_answer: chosen,
          correct_answer: q.correct_option,
          options: q.options,
          explanation: q.explanation,
          key_takeaway: q.key_takeaway,
          source: `${l?.title ?? q.lecture_id}, slides ${q.source.slides}`,
          recorded: true,
        };
        return {
          data,
          attempts: [
            {
              qid,
              ts: now,
              chosen,
              correct,
              confidence: (confidence ?? null) as Confidence | null,
              timeMs: Math.round((seconds ?? 0) * 1000),
              mode: 'custom',
              sessionId: `claude-${dayIn(now, env.TIMEZONE || 'America/Chicago')}`,
            },
          ],
          message: `Answer from Claude chat: ${qid} ${correct ? 'correct' : 'wrong'}`,
        };
      });
      return json(result);
    },
  );

  server.registerTool(
    'qbank_update_question',
    {
      title: 'Flag, note, archive, or report a question',
      description: 'Set a question’s flag, note, archived state, or a "possibly incorrect" report (null clears the report).',
      inputSchema: {
        qid: z.string(),
        flagged: z.boolean().optional(),
        note: z.string().optional(),
        archived: z.boolean().optional(),
        report: z.string().nullable().optional().describe('Reason it may be incorrect; null to clear'),
      },
      annotations: write,
    },
    async ({ qid, flagged, note, archived, report }) => {
      const now = Date.now();
      let found = true;
      await commitChange(env, (data) => {
        if (!data.questions.some((q) => q.qid === qid)) {
          found = false;
          return null;
        }
        const prev: Progress = data.progress.find((p) => p.qid === qid) ?? emptyProgress(qid);
        const next: Progress = {
          ...prev,
          ...(flagged !== undefined && { flagged }),
          ...(note !== undefined && { note }),
          ...(archived !== undefined && { archived }),
          ...(report !== undefined && { report: report === null ? null : { reason: report, at: now } }),
          metaUpdatedAt: now,
        };
        data.progress = [...data.progress.filter((p) => p.qid !== qid), next];
        return { data, message: `Update ${qid} from Claude chat` };
      });
      return text(found ? `Updated ${qid}.` : `No question ${qid}.`);
    },
  );

  return server;
}
