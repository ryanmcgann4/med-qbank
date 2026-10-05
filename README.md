# Q-Bank

A local-first practice question bank for med school lectures. Each lecture day you
generate questions in Claude with the built-in prompt, drop the resulting JSON
file in, and the app stores them, builds quizzes from your whole bank, schedules
reviews, and tracks what you've missed and what you haven't seen yet.

Everything lives in your browser's IndexedDB. There's no server, no account, and
nothing is uploaded anywhere.

## Run locally

Requires Node 22+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest: schema, dedupe, scheduler, quiz selection, import, backup/merge, stats, Anki
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build (service worker included)
```

To try it right away, click **Load 10 sample questions** on the home screen
(`public/sample/B2_W6_D1_2026-10-05.json`).

## Deploy

The build is a static site with relative paths and `#/` routes, so it works at
any URL (including a GitHub Pages subpath) with no rewrite rules.

**GitHub Pages (included workflow).**

1. Push this repo to GitHub.
2. In the repo, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main`. `.github/workflows/deploy.yml` runs the tests, builds, and
   publishes. Your app will be at `https://<you>.github.io/<repo>/`.

**Netlify:** New site → import the repo → build command `npm run build`, publish
directory `dist`. **Vercel:** import the repo; it detects Vite (output `dist`).

Deploying publishes the app, not your data. Your questions and progress stay
in each browser that uses it.

### Install on your phone

Open the deployed URL. On iPhone use **Share → Add to Home Screen** in Safari; on
Android use **Install app** in Chrome. It runs full-screen and works offline.
When a new version is deployed, a small "new version available" prompt lets
you reload when you're ready. It never reloads mid-question.

On iPhone, installing matters: Safari can clear storage for sites you haven't
visited in a while, but Home Screen apps are exempt. Back up regardless.

## Daily workflow

1. **Add → Generate in Claude.** Fill in course, code, week, day, and date (the
   day label fills itself in), then click **Copy generator prompt**.
2. Open a new Claude chat, paste the prompt, and attach that day's slides.
   Claude returns one file, e.g. `B2_W6_D1_2026-10-05.json`.
3. **Add → Import.** Drop the file (several at once is fine) or paste Claude's
   reply into **Paste JSON**. Code fences and chat text around the JSON are
   stripped automatically.
4. Review the summary (day label, lecture summaries, counts, errors,
   duplicates), then click **Import**, and optionally **Quiz me on these**.

The prompt can include your existing qids and stems for the same date, week, or
course so Claude avoids duplicates. It also tells Claude never to refer to
options by letter, because the app shuffles them.

## Import rules

- The contract is the Zod schema in `src/schema.ts`, published as
  `public/qbank-schema.json` (regenerate with `npm run schema`; a test fails if
  they drift).
- A broken file header rejects the whole file. Questions are validated one at
  a time, so the valid ones still import and the rest are listed with the exact
  field that failed (e.g. `Question 3 (B2-W6-D1-L1-Q003) · options[1].explanation is missing`).
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
| Exam simulation | Timed (90 s/question by default). Feedback is hidden until you end the block, and blanks count against the score but stay "unseen" in your bank |

Filters cover course, week, day, lecture, tag, question type, difficulty, and
status (unseen, missed, ever missed, lucky guess, flagged, due, mastered,
reported). Question and option order are shuffled. Answers are stored against
the original option ids, so the display letters don't matter. Questions you got
right in the last *N* days (default 3) are skipped unless they're due.

**Keyboard:** `1`–`5` / `A`–`E` select · `S` / `U` / `G` = Sure / Unsure / Guess
(submits in tutor mode) · `Enter` next · `←` back · `F` flag · `N` note · `?` help.
Right-click or long-press an answer to cross it out.

After a quiz: score, time, confidence check, every question re-openable, and
one-click **Re-quiz my misses**. Ending a tutor quiz early scores only what you
answered and offers **Finish the N unanswered**.

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
answers in a row. The home screen shows how many are due today.

## Stats & Library

- **Stats:** bank totals, mastered/learning/unseen, your 5 weakest lectures and
  tags (each with **Quiz me on these**), 7-day rolling accuracy and daily
  volume, calibration (accuracy when Sure / Unsure / Guess vs. 20% chance),
  accuracy by week, and sortable tables by lecture and tag. Every chart has a
  table view.
- **Library:** browse week → day → lecture with summaries and objectives. Each
  objective shows how many questions cite it, so gaps in Claude's coverage
  stand out. Full-text search covers stems, answers, explanations, tags, and
  lectures. Every question shows its answer history and next review date.
  **Delete day** / **Delete lecture** removes those questions and their history
  (e.g. to clear out the sample questions).

## Fixing questions

- **Edit** any question in-app (from a quiz, the review screen, or the Library).
  It gets an **Edited** marker, your history is kept, and **Revert to imported
  version** undoes it.
- **Possibly incorrect?** reports a question with a reason. Filter for
  **Reported issue** in the quiz builder or Library to check them against the
  slides, then **Mark resolved**.

## Sync between phone and laptop

**Data → Sync across devices** keeps every device's bank in sync through a
private GitHub repository you own. Each device keeps a full local copy, so the
app still works offline. It syncs when you open the app, when you leave it
(e.g. lock your phone), about 15 seconds after you answer, and every few
minutes while it's open. The header shows the status; tap it to sync now.

Setup, once:

1. Create a **private** repo with a README (e.g. `qbank-data`).
2. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new):
   *Only select repositories →* that repo, *Permissions → Contents → Read and write*.
3. On your first device, paste the repo (`owner/name`) and token and click
   **Connect & sync**.
4. On each other device, use **Copy setup code** on the first device, send it to
   yourself (AirDrop/Notes), and paste it under *Already set up on another device?*

How merging works: answers from every device are combined and progress is
recalculated from the combined history. Edits, flags, and notes go newest-first,
and deleting a day or lecture removes it everywhere. The repo's commit history
doubles as versioned backups. The token is stored only in that browser and is
never included in backups or the synced data.

## Backup, restore, and moving between devices

On the **Data** page:

- **Download backup** saves one JSON file with every question, lecture, answer,
  note, flag, report, and quiz. A banner reminds you weekly; dismissing it
  snoozes it for a week.
- **Restore → Merge** combines a backup with what's in this browser. Answer
  histories from both are unioned and progress is recalculated from the
  combined history, so you can sync a phone and a laptop by backing up on one
  and merging on the other.
- **Restore → Replace** makes this browser an exact copy of the backup. A backup
  of the current data downloads first.

## Anki export

**Data → Export to Anki** picks questions by status (missed, ever missed, lucky
guess, flagged, reported, mastered) and week and downloads a CSV. In Anki use
**File → Import**: the file's header lines set the separator, HTML, note type
(Basic), deck, and a tags column. Front = stem + options; Back = answer +
explanation + key takeaway + source. Tags include the course, week, lecture,
and the question's own tags.

## Project layout

```
src/schema.ts          import contract (Zod) → public/qbank-schema.json
src/db.ts              Dexie tables: questions, lectures, progress, attempts, sessions, imports, kv
src/lib/validate.ts    JSON extraction + per-question validation with readable errors
src/lib/dedupe.ts      qid / content-hash matching, diffs
src/lib/importer.ts    plan + apply an import (never touches progress)
src/lib/srs.ts         scheduler
src/lib/selection.ts   filters, modes, smart ordering, weekly weighting
src/lib/tracking.ts    recording answers, progress updates
src/lib/backup.ts      export, restore, two-device merge
src/lib/anki.ts        Anki CSV
src/lib/stats.ts       aggregations for the Stats page
src/lib/edit.ts        in-app edits + revert
src/lib/sync/…         GitHub sync: file layout (shards), Git client, sync engine, auto-sync triggers
src/lib/prompt.ts      the generator prompt
src/pages/…            Home, Add, Quiz builder, Quiz runner, Review, Library, Stats, Data
```
