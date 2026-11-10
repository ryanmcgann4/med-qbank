/**
 * Add a day file (the qbank-generator skill's JSON) to the bank, as the app's
 * importer does: new questions are added, exact repeats skipped, and clashes
 * reported rather than overwritten. Shared by the connector's qbank_import and
 * the Mac's "Make Q-Bank Questions" action (scripts/qbank-local.ts).
 */
import type { StoredLecture } from '../../src/db';
import { classifyQuestions } from '../../src/lib/dedupe';
import { contentHash } from '../../src/lib/hash';
import type { BackupData } from '../../src/lib/merge';
import { autoChain } from '../../src/lib/org';
import { validateText } from '../../src/lib/validate';
import type { Change } from './bank';

export function importDay(data: BackupData, fileJson: string, fileName: string, now: number): { change: Change | null; report: Record<string, unknown> } {
  const known = new Set(data.lectures.map((l) => l.lecture_id));
  const v = validateText(fileJson, fileName, known);
  if (!v.ok || !v.meta) return { change: null, report: { imported: 0, errors: v.fileErrors.map((e) => `${e.field}: ${e.message}`) } };

  const classified = classifyQuestions(
    v.questions.map((question) => ({ question, fileIndex: 0 })),
    data.questions,
  );
  const added = classified.filter((c) => c.kind === 'new');
  const report = {
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
  // File it under Course › Week › Day now, the way the app would: a device that gets it by sync
  // may not file it until much later, leaving it loose at the top of the library.
  const fileInDay = () => {
    const folders = (data.folders ??= []);
    const chain = autoChain({ course: meta.course, week: meta.week, day_label: meta.day_label });
    for (const f of chain) {
      if (folders.some((x) => x.id === f.id)) continue;
      // If you deleted this folder before, recreate it newer than the delete so it sticks.
      const deleted = data.deletions?.some((d) => d.id === `folder:${f.id}`);
      folders.push({ ...f, updatedAt: deleted ? now : 0 });
    }
    return chain[chain.length - 1].id;
  };
  for (const l of v.lectures) {
    const prev = data.lectures.find((x) => x.lecture_id === l.lecture_id);
    const fresh: StoredLecture = {
      ...l,
      course: meta.course,
      week: meta.week,
      day_label: meta.day_label,
      date: meta.date,
      importedAt: prev?.importedAt ?? now,
      // null is a deliberate move to the top level; only a lecture never filed gets a folder.
      folderId: prev?.folderId === undefined ? fileInDay() : prev.folderId,
      movedAt: prev?.movedAt,
      ...(prev?.renamedAt ? { title: prev.title, renamedAt: prev.renamedAt, importedTitle: l.title } : {}),
    };
    data.lectures = [...data.lectures.filter((x) => x.lecture_id !== l.lecture_id), fresh];
  }
  for (const c of added) data.questions.push({ ...c.question, hash: contentHash(c.question), importedAt: now, updatedAt: now, editedAt: null });
  data.imports.push({
    importedAt: now,
    files: [{ name: fileName, day_label: meta.day_label, course: meta.course, week: meta.week, date: meta.date }],
    lectureIds: v.lectures.map((l) => l.lecture_id),
    added: added.length,
    overwritten: 0,
    keptBoth: 0,
    skipped: classified.length - added.length,
    invalid: v.skipped.length,
  });
  return { change: { data, message: `Import ${meta.day_label} from Claude (${added.length} questions)` }, report };
}
