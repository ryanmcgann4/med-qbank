# Q-Bank

A local-first practice question bank for med school lectures. Each lecture day you
generate questions in Claude with the built-in prompt, drop the resulting JSON
file in, and the app stores them, builds quizzes from your whole bank, and
tracks what you've missed and what's due.

Everything lives in your browser's IndexedDB. There's no server and no login.

## Run locally

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest: schema, dedupe, scheduler, quiz selection, import
npm run build      # type-check + production build into dist/
```

To try it right away, click **Load 10 sample questions** on the home screen
(`public/sample/B2_W6_D1_2026-10-05.json`).

## Daily workflow

1. **Add → Generate in Claude.** Fill in course, week, day, and date (the day
   label fills itself in), then click **Copy generator prompt**.
2. Open a new Claude chat, paste the prompt, and attach that day's slides.
   Claude returns one file, e.g. `B2_W6_D1_2026-10-05.json`.
3. **Add → Import.** Drop the file (several at once is fine) or paste Claude's
   reply into **Paste JSON**. Code fences and chat text around the JSON are
   stripped automatically.
4. Review the summary (day label, lecture summaries, counts, errors,
   duplicates), then click **Import**.

The prompt can include your existing qids and stems for the same date, week, or
course, so Claude avoids writing duplicates.

## Import rules

- The contract is the Zod schema in `src/schema.ts`, published as
  `public/qbank-schema.json` (regenerate with `npm run schema`; a test fails if
  they drift).
- A broken file header rejects the whole file. Questions are validated one at
  a time, so the valid ones still import and the rest are listed with the exact
  field that failed (e.g. `Question 3 (B2-W6-D1-L1-Q003) › options[1].explanation is missing`).
- **Duplicates** are matched by `qid` first, then by a normalized hash of the
  stem and options (case, punctuation, whitespace, and option order are ignored).
  - Identical re-imports are skipped automatically.
  - Same qid with different content, or the same question under a new qid, shows
    a word-level diff and lets you choose **Skip** (default), **Overwrite**, or
    **Keep both** (the copy gets a `~2` suffix).
  - Your progress is keyed by qid and is never touched by an import.
    Overwriting a question keeps its history, flag, and note.

## Quizzes

| Mode | What it serves |
| --- | --- |
| Smart mix (default) | Due reviews (most overdue first) → last-attempt misses → unseen → everything else, weakest first |
| Unseen only | Questions you haven't answered |
| Redemption run | Questions you got wrong last time |
| Weekly review | One week, weighted toward weak lectures and questions you missed or guessed on |
| Exam simulation | Timed (90 s/question by default). Feedback is hidden until you end the block, and blanks count against the score |

Filters cover course, week, day, lecture, tag, question type, difficulty, and
status. Question and option order are shuffled. Answers are stored against the
original option ids, so the display letters don't matter. Questions you got right
in the last *N* days (default 3) are skipped unless they're due.

**Keyboard:** `1`–`5` / `A`–`E` select · `S` / `U` / `G` = Sure / Unsure / Guess
(submits in tutor mode) · `Enter` next · `←` back · `F` flag · `N` note · `?` help.
Right-click or long-press an answer to cross it out.

## Spaced repetition

Leitner boxes (`src/lib/srs.ts`):

| Box | 1 | 2 | 3 | 4 | 5 | 6 |
| --- | --- | --- | --- | --- | --- | --- |
| Wait (days) | 1 | 3 | 7 | 14 | 30 | 60 |

- ❌ Wrong → box 1, back tomorrow
- ✅ Correct + Guess → box 1, back tomorrow
- ✅ Correct + Unsure → same box, half its wait
- ✅ Correct + Sure → up one box (only if it was due; early reviews don't promote)

**Mastered** means box 4 or higher, which takes three spaced, confident correct
answers in a row.

## Project layout

```
src/schema.ts          import contract (Zod) → public/qbank-schema.json
src/db.ts              Dexie tables: questions, lectures, progress, attempts, sessions, imports
src/lib/validate.ts    JSON extraction + per-question validation with readable errors
src/lib/dedupe.ts      qid / content-hash matching, diffs
src/lib/importer.ts    plan + apply an import (never touches progress)
src/lib/srs.ts         scheduler
src/lib/selection.ts   filters, modes, smart ordering, weekly weighting
src/lib/prompt.ts      the generator prompt
src/pages/…            Home, Add, Quiz builder, Quiz runner, Review
```

## Coming next

Stats dashboard, lecture library, backup/restore, Anki CSV export, in-app
editing, "possibly incorrect" reports, a weekly backup reminder, PWA/offline
install, and deploy instructions.
