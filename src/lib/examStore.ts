import { db as defaultDb, type Exam, type QBankDB } from '../db';
import { randomId } from './rng';

export async function saveExam(exam: Omit<Exam, 'id' | 'updatedAt'> & { id?: string }, database: QBankDB = defaultDb): Promise<Exam> {
  const full: Exam = { ...exam, id: exam.id ?? randomId(), updatedAt: Date.now() };
  await database.exams.put(full);
  return full;
}

export async function deleteExam(id: string, database: QBankDB = defaultDb): Promise<void> {
  await database.transaction('rw', [database.exams, database.deletions], async () => {
    await database.exams.delete(id);
    await database.deletions.put({ id: `exam:${id}`, kind: 'exam', key: id, at: Date.now() });
  });
}
