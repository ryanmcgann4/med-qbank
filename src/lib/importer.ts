import { db as defaultDb, type QBankDB, type StoredLecture, type StoredQuestion } from '../db';
import { classifyQuestions, defaultResolution, freeQid, type Classified, type Resolution } from './dedupe';
import { validateText, type FileValidation } from './validate';

export interface ImportSource {
  name: string;
  text: string;
}

export interface PlanItem extends Classified<StoredQuestion> {
  key: string;
  resolution: Resolution;
}

export interface PlannedLecture {
  lecture: StoredLecture;
  isNew: boolean;
  fileIndex: number;
}

export interface ImportPlan {
  files: FileValidation[];
  items: PlanItem[];
  lectures: PlannedLecture[];
}

export interface ImportOutcome {
  importId: number;
  added: number;
  overwritten: number;
  keptBoth: number;
  skipped: number;
  invalid: number;
  lectureIds: string[];
  qids: string[];
}

export async function planImport(sources: ImportSource[], database: QBankDB = defaultDb, now = Date.now()): Promise<ImportPlan> {
  const knownLectureIds = new Set((await database.lectures.toCollection().primaryKeys()) as string[]);
  const files = sources.map((s) => validateText(s.text, s.name, knownLectureIds));

  const batch = files.flatMap((f, fileIndex) => f.questions.map((question) => ({ question, fileIndex })));
  const existing = await database.questions.toArray();
  const items: PlanItem[] = classifyQuestions(batch, existing).map((c, i) => ({
    ...c,
    key: `${c.fileIndex}:${i}:${c.question.qid}`,
    resolution: defaultResolution(c.kind),
  }));

  const lectures: PlannedLecture[] = [];
  files.forEach((f, fileIndex) => {
    if (!f.ok || !f.meta) return;
    for (const l of f.lectures) {
      lectures.push({
        fileIndex,
        isNew: !knownLectureIds.has(l.lecture_id),
        lecture: {
          ...l,
          course: f.meta.course,
          week: f.meta.week,
          day_label: f.meta.day_label,
          date: f.meta.date,
          importedAt: now,
        },
      });
    }
  });

  return { files, items, lectures };
}

/**
 * Write the plan. Progress records are keyed by qid and are never touched
 * here, so overwriting a question keeps its history, flags and notes.
 */
export async function applyImport(
  plan: ImportPlan,
  resolutions: Record<string, Resolution> = {},
  database: QBankDB = defaultDb,
  now = Date.now(),
): Promise<ImportOutcome> {
  const outcome: Omit<ImportOutcome, 'importId'> = {
    added: 0,
    overwritten: 0,
    keptBoth: 0,
    skipped: 0,
    invalid: plan.files.reduce((n, f) => n + f.skipped.length + (f.ok ? 0 : f.totalQuestions), 0),
    lectureIds: [],
    qids: [],
  };

  const importId = await database.transaction(
    'rw',
    [database.questions, database.lectures, database.imports],
    async () => {
      for (const { lecture } of plan.lectures) {
        const prev = await database.lectures.get(lecture.lecture_id);
        await database.lectures.put({ ...lecture, importedAt: prev?.importedAt ?? lecture.importedAt });
        if (!outcome.lectureIds.includes(lecture.lecture_id)) outcome.lectureIds.push(lecture.lecture_id);
      }

      const taken = new Set((await database.questions.toCollection().primaryKeys()) as string[]);

      for (const item of plan.items) {
        const resolution = resolutions[item.key] ?? item.resolution;
        const base = { ...item.question, hash: item.hash, updatedAt: now, editedAt: null };

        if (resolution === 'add' && !taken.has(item.question.qid)) {
          await database.questions.add({ ...base, importedAt: now });
          taken.add(item.question.qid);
          outcome.added++;
          outcome.qids.push(item.question.qid);
        } else if (resolution === 'overwrite' && item.existing) {
          const qid = item.existing.qid;
          await database.questions.put({ ...base, qid, importedAt: item.existing.importedAt });
          outcome.overwritten++;
          outcome.qids.push(qid);
        } else if (resolution === 'keep_both') {
          const qid = taken.has(item.question.qid) ? freeQid(item.question.qid, taken) : item.question.qid;
          await database.questions.add({ ...base, qid, importedAt: now });
          taken.add(qid);
          outcome.keptBoth++;
          outcome.qids.push(qid);
        } else {
          outcome.skipped++;
        }
      }

      return database.imports.add({
        importedAt: now,
        files: plan.files
          .filter((f) => f.ok && f.meta)
          .map((f) => ({ name: f.name, day_label: f.meta!.day_label, course: f.meta!.course, week: f.meta!.week, date: f.meta!.date })),
        lectureIds: outcome.lectureIds,
        added: outcome.added,
        overwritten: outcome.overwritten,
        keptBoth: outcome.keptBoth,
        skipped: outcome.skipped,
        invalid: outcome.invalid,
      });
    },
  );

  return { ...outcome, importId: importId as number };
}

/**
 * Remove lectures with their questions and the progress/answer history for
 * those questions. Past quiz sessions keep their records; removed questions
 * show as "removed from bank" there.
 */
export async function deleteLectures(lectureIds: readonly string[], database: QBankDB = defaultDb): Promise<{ lectures: number; questions: number }> {
  const tables = [database.questions, database.lectures, database.progress, database.attempts, database.deletions];
  return database.transaction('rw', tables, async () => {
    const qids = (await database.questions.where('lecture_id').anyOf([...lectureIds]).primaryKeys()) as string[];
    const at = Date.now();
    await database.deletions.bulkPut([
      ...lectureIds.map((key) => ({ id: `lecture:${key}`, kind: 'lecture' as const, key, at })),
      ...qids.map((key) => ({ id: `question:${key}`, kind: 'question' as const, key, at })),
    ]);
    await database.attempts.where('qid').anyOf(qids).delete();
    await database.progress.bulkDelete(qids);
    await database.questions.bulkDelete(qids);
    await database.lectures.bulkDelete([...lectureIds]);
    return { lectures: lectureIds.length, questions: qids.length };
  });
}
