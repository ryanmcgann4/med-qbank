import type { StoredLecture, StoredQuestion } from '../db';

/**
 * "Open slides" hands off to the Q-Bank Slides helper on a Mac (mac-slides/), which
 * opens the lecture's PowerPoint or PDF at the cited slide. It's a per-device choice,
 * since only a computer with the helper and the slide files can do anything with it.
 */
const KEY = 'qbank-open-slides';

export function slidesOnThisDevice(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setSlidesOnThisDevice(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
}

/** The helper finds the file by lecture id, or by title in Week <week> / that day's folder. */
export function slideLink(q: StoredQuestion, lecture: StoredLecture | undefined): string {
  const params = new URLSearchParams({
    lecture: q.lecture_id,
    src: q.source.slides,
    ...(lecture ? { course: lecture.course, title: lecture.importedTitle ?? lecture.title, week: String(lecture.week), date: lecture.date } : {}),
  });
  return `qbank-slides://open?${params}`;
}
