# Q-Bank to-do list

Work that came out of the November 2026 audit and hasn't been done yet. Each
item says why it matters, where the code is, how to build it, and how to tell
it's finished. Items are independent unless one says otherwise.

Suggested order: 1 → 7 → 2 → 9 → 4 → 6 → 5 → 3 → 8, then the rest.

## Read this first (applies to every item)

**Check your work.** Before calling anything done:

```bash
npm test                              # must stay green; add tests for what you change
npm run lint
npm run build                         # type-checks the app and the tests
(cd connector && npx tsc --noEmit)    # the connector imports app code, so app changes can break it
```

Then run the built app (`npm run preview`, port 4173, or the `qbank-preview`
entry in `.claude/launch.json`) and click through the feature. The production
build has a Content-Security-Policy (`vite.config.ts`): no inline scripts, and
network requests only to the app itself and `api.github.com`.

**Three programs share one data format.** The app (`src/`), the Claude
connector (`connector/`, a Cloudflare Worker), and the Mac script
(`scripts/qbank-local.ts`) all read and write the same private GitHub sync
repo using the same code in `src/lib/`. Devices update at different times (the
phone only updates when "new version available" is tapped), so for a while an
old version and a new version will sync against each other. Therefore:

- New fields on existing rows must be **optional**, and old code must keep
  working when it sees them (it will: unknown fields are carried along,
  because rows are stored and merged whole).
- Never rename or remove a field, a file path in the sync repo, or the meaning
  of an existing value. Add instead.
- Rows merge "newest wins" by a timestamp on the row (`updatedAt`,
  `metaUpdatedAt`, `movedAt`, `renamedAt`). Any change you make to a row must
  bump the right timestamp or it won't reach other devices.
- Deletes need a tombstone in the `deletions` table, or sync brings the row
  back. See `deleteLectures` in `src/lib/importer.ts` for the pattern.
- Progress (times seen, schedule) is never synced. It's rebuilt from the
  answer history in `mergeData` (`src/lib/merge.ts`). Don't store anything in
  `progress` that can't be rebuilt, except the "meta" fields (flag, note,
  report, archived).

**Adding a new synced table** touches all of these; miss one and data silently
doesn't sync or isn't backed up:

1. `src/db.ts`: the interface, the `EntityTable` field, and a new
   `this.version(n).stores({...})` line (never edit an old version line).
2. `src/lib/merge.ts`: `BackupData` (optional field) and merging in `mergeData`.
3. `src/lib/backup.ts`: `BackupShape`, `readAll`, `allTables`, `replaceAll`,
   `writeChanges`.
4. `src/lib/sync/shards.ts`: `MANAGED` regex, `SHARD_TABLES`, `toShards`,
   `fromShards`.
5. `src/lib/sync/engine.ts`: the `EMPTY` constant.
6. `src/lib/sync/controller.ts`: the table-name regex in `startAutoSync` that
   decides which writes trigger a sync.
7. Tests in `src/lib/backup.test.ts` and `src/lib/sync/sync.test.ts`
   (two fake devices syncing through `FakeRepo`).

Prefer not adding a table. The existing `settings` table (key, value,
`updatedAt`, newest wins, already synced) is enough for small things.

**Deploying.** Pushing to `main` deploys the app (GitHub Pages). The connector
deploys separately with `npx wrangler deploy` in `connector/`. Changes under
`mac-slides/` need `mac-slides/install.sh` rerun, because the installed helper
app holds copies of the scripts.

---

## Organization features

### 1. Exams that span several courses or folders

**Why.** An exam is one course plus some of its weeks (`Exam` in `src/db.ts`).
Step 1, Step 2 and shelf exams cover many courses, so they can't have a
countdown or daily plan.

**Where.** `src/db.ts` (`Exam`), `src/lib/exams.ts` (`inExam`, `planFor`,
`releasedByExams`), `src/components/ExamCard.tsx` (the form and the card),
`src/lib/examStore.ts`, `connector/src/tools.ts` (`qbank_overview` calls
`planFor`), tests in `src/lib/exams.test.ts`.

**How.**

1. Add two optional fields to `Exam`: `courses?: string[]` (extra whole
   courses) and `folderIds?: string[]` (Library folders; everything inside
   counts). Keep `course` and `weeks` exactly as they are so old versions still
   show something sensible; when the user picks several courses, put the first
   in `course`.
2. `inExam(c, exam)` only sees one question, but folder membership needs the
   folder tree. Add a function in `exams.ts` that turns an exam into a set of
   lecture ids once: use `buildTree` and `lecturesUnder` from `src/lib/org.ts`
   for each `folderIds` entry, plus lectures whose `course` is in `courses`,
   plus the existing course/weeks rule. Change `inExam` to take that set (or
   return a predicate, like `releasedByExams` does). Update every caller:
   `planFor`, `releasedByExams`, `ExamCard.tsx`, `src/lib/tracking.ts`
   (`createQuiz`), `connector/src/tools.ts` (`load`), `HomePage.tsx`.
3. In the `ExamCard` form, replace the single course input with a
   multi-select of courses and a folder picker (the quiz builder already has a
   Folders filter in `src/pages/QuizBuilderPage.tsx` to copy from).
4. An exam with nothing selected except `course` must behave exactly as today.

**Done when.** A test creates an exam covering two courses and one folder and
`planFor` counts questions from all three; an old-style exam's plan is
unchanged; a two-device sync test shows the new fields arriving intact; the
connector type-checks.

### 2. Organ system and discipline on every question

**Why.** Tags are free text, so "cardio", "Cardiology" and "CV" are three
different things and "all cardiovascular pharmacology across blocks" can't be
asked for reliably. Boards are organized by system × discipline.

**Where.** `src/schema.ts` (the import contract), `public/qbank-schema.json`
(generated), `claude-skill/qbank-generator/` (`SKILL.md`, `reference/format.md`,
`scripts/validate_qbank.py`), `src/lib/prompt.ts`, `src/db.ts` (`QuizFilters`),
`src/lib/selection.ts` (`matchesFilters`, `emptyFilters`), `src/lib/edit.ts`
(`CONTENT_KEYS`), `src/lib/dedupe.ts` (`ratingChanged`), `src/lib/importer.ts`
and `connector/src/importDay.ts` (how `yield` is updated on re-import),
`src/pages/QuizBuilderPage.tsx`, `src/lib/stats.ts`, `src/pages/StatsPage.tsx`,
`connector/src/tools.ts` (`qbank_quiz_start`).

**How.** Copy how `yield` was added; it is the template for an optional,
enumerated, re-importable field (`git log -S"YieldSchema" --oneline` finds the
commit).

1. In `schema.ts` add `SYSTEMS` and `DISCIPLINES` constant lists (use the
   USMLE content outline's names: cardiovascular, respiratory, renal, …;
   anatomy, physiology, pathology, pharmacology, microbiology, biochemistry, …),
   Zod enums, label maps, and two **optional** fields on `QuestionSchema`.
   Do not change `FORMAT_VERSION`. Run `npm run schema`.
2. Teach the generator: add the fields and the allowed values to
   `reference/format.md`, `SKILL.md`, `validate_qbank.py`, and `src/lib/prompt.ts`.
   `src/lib/skill.test.ts` checks the skill and schema agree.
3. Add `'system'` and `'discipline'` to `CONTENT_KEYS` in `edit.ts` and to the
   edit form in `src/components/QuestionTools.tsx`.
4. Extend `ratingChanged` (or add a sibling) so re-importing a day file fills
   in system/discipline on questions already in the bank that the user hasn't
   edited, in both `importer.ts` (`applyImport`, the `identical` branch) and
   `connector/src/importDay.ts`. Bump `updatedAt` when it does.
5. Add optional `systems?: string[]` and `disciplines?: string[]` to
   `QuizFilters`; handle them in `matchesFilters` with the same
   "missing = no filter, `unrated` = questions without a value" rule as
   `yields`. Add chips to the quiz builder and the Library filter.
6. Add "by system" and "by discipline" tables to Stats (copy `byTag` in
   `stats.ts`).
7. Add optional `system` / `discipline` inputs to `qbank_quiz_start`.
8. Backfill the existing bank: questions are grouped by lecture in the sync
   repo (`questions/<lecture_id>.json`). The practical route is a one-off
   script modelled on `scripts/qbank-local.ts` that loads the bank with
   `snapshot`, asks Claude to classify each question (stem + key takeaway are
   enough), and writes back with `commitChange`, setting the two fields and
   `updatedAt = now`. Do a `--dry-run` first and spot-check 30 questions.

**Done when.** A day file with the fields imports and one without still does;
the schema drift test passes; a quiz filtered to one system returns only those
questions; re-importing a file adds the fields to existing unedited questions
and leaves edited ones alone.

### 3. Question sources that aren't a lecture day

**Why.** Every import file needs `week`, `day_label` and `date`, and is filed
under Course › Week › Day. Clerkships, shelf prep and residency material don't
have weeks and days.

**Where.** `src/schema.ts` (`envelopeShape`), `src/lib/org.ts` (`autoChain`,
`ensureOrganization`, `autoNames`), `connector/src/importDay.ts` (`fileInDay`),
`src/lib/importer.ts`, `src/db.ts` (`StoredLecture`), the generator skill and
`src/lib/prompt.ts`, `src/pages/AddQuestionsPage.tsx`.

**How.**

1. Add one optional envelope field, `collection: string[]` (a folder path such
   as `["Surgery clerkship", "Shelf prep"]`). Keep `week`, `day_label` and
   `date` required so old files and old app versions are unaffected; for
   collection files the generator writes `week: 0`, the date the file was made,
   and a readable `day_label`.
2. Store `collection` on `StoredLecture` (optional).
3. In `autoChain`, when a lecture has `collection`, return one folder per path
   segment instead of Course › Week › Day. Give each an `autoKey` like
   `collection:<seg1>/<seg2>` so `autoFolderId` produces the same id on every
   device (that is what stops two devices creating duplicate folders).
   `fileInDay` in `importDay.ts` and `ensureOrganization` both go through
   `autoChain`, so they follow automatically; check both.
4. Anywhere "Week 0" would be shown for these lectures (Library labels, quiz
   builder week chips, Anki tags in `src/lib/anki.ts`, exam week pickers), show
   the collection path instead or leave them out of week lists.
5. Add a "Not a lecture day" mode to the Add page's prompt form and to the
   skill's instructions.

**Done when.** A collection file imports and lands in the right nested
folders on two synced devices with one set of folders; an ordinary day file
behaves exactly as before; week filters don't show a stray "Week 0".

### 4. Saved quiz presets

**Why.** Rebuilding the same filter combination (e.g. "high-yield, missed or
due, Block 3") every time is slow.

**Where.** `src/lib/settings.ts` (`setSetting`, `getSetting`),
`src/pages/QuizBuilderPage.tsx`, `src/pages/HomePage.tsx`, `src/db.ts`
(`QuizConfig`).

**How.** No new table. Use the synced `settings` table with one row per
preset: key `quizPreset:<id>` (`randomId()` from `src/lib/rng.ts`), value
`{ name, config: QuizConfig }`, or `null` once deleted (settings have no
tombstones; a `null` value with a newer `updatedAt` is the delete). One row per
preset means two devices adding different presets don't overwrite each other.

1. Add `listPresets`, `savePreset`, `deletePreset` to `settings.ts` (list =
   `db.settings.where('key').startsWith('quizPreset:')`, dropping `null`s).
2. Quiz builder: "Save as preset" (asks for a name) and a row of preset chips
   that load a config into the form.
3. Home: a "Presets" row that starts a quiz in one tap via `useStartQuiz`.
4. Presets store filters by id (lecture ids, folder ids). When loading one,
   drop ids that no longer exist instead of matching nothing.

**Done when.** A preset made on one fake device appears on the other after
sync; deleting it on either removes it on both; a preset pointing at a deleted
lecture still starts a quiz.

### 5. Tag cleanup (rename, merge, bulk retag)

**Why.** Free-text tags drift ("abx", "antibiotics"), which splits stats and
filters.

**Where.** New `src/lib/tags.ts`; the `questions` table has a multi-entry
index on tags (`*tags` in `src/db.ts`); UI in `src/pages/LibraryPage.tsx` or
`src/pages/DataPage.tsx`.

**How.**

1. `renameTag(from, to)`: in one transaction, find questions with
   `db.questions.where('tags').equals(from)`, replace the tag (dedupe the
   array, so renaming onto an existing tag is a merge), and set
   `updatedAt = Date.now()` so it syncs. Leave `editedAt`, `original` and
   `hash` alone: tags aren't part of the content hash, and this shouldn't mark
   questions as "Edited".
2. `addTag(qids, tag)` / `removeTag(qids, tag)` the same way, for the
   Library's existing Select mode.
3. A "Tags" panel listing every tag with its question count (reuse `byTag`
   from `src/lib/stats.ts`), each with Rename and Merge into….
4. Matching is case-insensitive in `matchesFilters`; offer to merge tags that
   differ only by case.

**Done when.** Renaming a tag updates every question that had it, the change
reaches a second device, and re-importing the original day file doesn't bring
the old tag back (identical questions are skipped on import; confirm with a
test).

### 6. Delete or move a single question

**Why.** Only whole lectures or days can be deleted. One bad or misfiled
question can only be archived.

**Where.** `src/lib/importer.ts` (`deleteLectures` is the pattern),
`src/components/QuestionTools.tsx` (the per-question tools), `src/lib/merge.ts`
(already honours `question:<qid>` tombstones).

**How.**

1. `deleteQuestions(qids)` next to `deleteLectures`: one transaction over
   `questions`, `progress`, `attempts`, `deletions`; write a
   `{ id: 'question:<qid>', kind: 'question', key: qid, at: now }` tombstone per
   question, delete its attempts and progress, then the question.
2. `moveQuestions(qids, lectureId)`: set `lecture_id` and
   `updatedAt = Date.now()`. Sync files are grouped by `lecture_id`, so the
   question moves between files by itself. The qid keeps its old lecture code;
   that's cosmetic and must not be changed (progress is keyed by qid).
3. Add "Delete" (with a confirm that says the answer history goes too) and
   "Move to lecture…" to `QuestionTools`, and to the Library's Select mode.
4. Past quiz sessions already show "removed from your bank" for missing
   questions; check that screen still works.

**Done when.** A sync test deletes one question on device A and it disappears
from device B without coming back on B's next push; a moved question shows
under the new lecture on both devices with its history intact.

---

## Longevity

### 7. Stop past quizzes from piling up in the sync repo

**Why.** Every quiz is its own file (`sessions/<id>.json`, about 14 KB). Six
weeks of use produced 177 of them (2.5 MB); that is roughly 1,500 files a year,
and every file is a separate download for a new device. They are only used by
the quiz review screen; scores and schedules come from `attempts`.

**Where.** `src/lib/sync/shards.ts` (`toShards`), `src/lib/sync/engine.ts`,
`src/lib/merge.ts` (session merging), `src/db.ts` (`QuizSession`).

**How.** Do both parts.

1. *Slim each file.* A finished session doesn't need `config.qids` (it repeats
   `items`) or the `struck` arrays. Strip them when a quiz finishes
   (`finish` in `src/pages/QuizPage.tsx`), and check
   `src/pages/QuizReviewPage.tsx` doesn't read them.
2. *Keep old ones on the device only.* In `toShards`, leave out sessions that
   finished more than 90 days ago. The engine deletes remote files the device
   doesn't produce, so they leave the repo, while the local copy stays for
   review. Make sure `mergeData` doesn't drop local sessions that are missing
   from the incoming data (it doesn't today; add a test so it stays that way).
   The cutoff must be computed from `finishedAt` alone (not "now" at different
   moments on different devices crossing a boundary mid-sync is fine, since the
   only effect is one extra commit).
3. Rollout: until every device has the new version, an old device will
   re-upload the old sessions and a new one will remove them again. Nothing is
   lost, it just makes extra commits, so update all devices the same day.

**Done when.** A sync test with a 100-day-old finished session shows it absent
from `FakeRepo.files()` but still in the device's `sessions` table, and a
recent one present in both.

### 8. Keep the app fast as the bank grows

**Why.** `useCandidates` (`src/hooks/useBank.ts` → `loadCandidates` in
`src/lib/tracking.ts`) re-reads every question, lecture and progress row
whenever anything changes, including after every answer. Each sync pull
(`mergeIntoChanged` in `src/lib/backup.ts`) reads the whole database, replays
every answer, and compares every row. At tens of thousands of questions this
will lag on a phone.

**How.** Measure first; don't optimize blind.

1. Write a script or test helper that fills a database with ~30,000 questions
   and ~150,000 attempts (see `src/test/fixtures.ts`), then time
   `loadCandidates`, `mergeIntoChanged` with a one-file pull, and `localState`.
2. `loadCandidates`: questions change rarely, progress changes constantly.
   Cache the question and lecture arrays in memory, invalidated by Dexie's
   `storagemutated` event for those tables (the engine already listens to it in
   `engine.ts`), and re-read only `progress` per change.
3. `mergeIntoChanged`: only read and merge the tables the incoming files can
   affect. A pull containing only `attempts/…` files needs `attempts`,
   `progress` and `deletions`, not `questions` or `sessions`. Rebuild progress
   only for the qids that have incoming attempts. Keep the full merge for
   backups and for pulls that include `deletions.json`.
4. Pages that only need counts (Home) should use indexed counts, not the full
   candidate list.

**Done when.** With the synthetic bank, answering a question triggers no full
read of `questions`, a one-file pull takes under ~200 ms on a laptop, and all
existing merge and sync tests still pass unchanged.

### 9. Remind about file backups even when sync is healthy

**Why.** `src/components/BackupBanner.tsx` hides the weekly reminder whenever
sync succeeded in the last week, so GitHub becomes the only copy off your
devices.

**How.** In `BackupBanner.tsx`, when sync is healthy, still show the banner if
the last downloaded backup (`LAST_BACKUP_KEY`) is more than 30 days old; keep
the 7-day rule when sync is off or failing. Reword the text for the synced
case ("Sync is on, but a backup file protects you if the GitHub account is
ever lost").

**Done when.** With sync healthy and a 31-day-old backup the banner shows;
at 29 days it doesn't.

### 10. Warn before the GitHub token expires

**Why.** Tokens expire (a year at most). The app now shows a banner once sync
has failed, but a warning beforehand is better. The browser can't read the
expiry from GitHub (that response header isn't exposed to web pages).

**How.** Add an optional "Token expires on" date to the connect form and the
new "Token expired?" box in `src/pages/DataPage.tsx`; store it in the
device-local sync config (`SyncConfig` in `src/lib/sync/github.ts`, saved by
`saveConfig` in `controller.ts`; include it in the setup code). Show a notice
in `src/components/SyncBanner.tsx` from 14 days before that date.

**Done when.** A config with an expiry 10 days out shows the notice; one 30
days out doesn't; a config without the field behaves as today.

### 11. Group answers by UTC day instead of local day

**Why.** `toShards` names answer files with `todayISO(a.ts)`, the device's
local date. Moving time zones (or two devices set to different zones) makes
devices disagree about which file a late-night answer belongs in, so they
rewrite each other's files. No data is lost; it just churns commits.

**How.** In `shards.ts`, name the file from the UTC date
(`new Date(a.ts).toISOString().slice(0, 10)`). In `connector/src/bank.ts`,
`commitChange` appends to day files using `dayIn(ts, tz)`; switch that to the
same UTC rule. The first sync after the change rewrites existing answer files
once. As with item 7, old and new versions will rewrite each other's files
until every device is updated, so update them the same day and redeploy the
connector.

**Done when.** A test builds shards for the same attempts under two different
`TZ` values and gets byte-identical files.

### 12. Fewer sync commits

**Why.** About 50 commits a day (2,047 in six weeks). Harmless now, but the
repo history only grows.

**How.** In `src/lib/sync/controller.ts`, raise `DEBOUNCE_MS` from 15 s to
60–120 s (leaving the app still syncs immediately, via the
`visibilitychange` handler, so nothing is at risk). In `engine.ts`, don't push
when the only local difference is an unfinished session's timer: skip
uploading `sessions/…` files whose session has no `finishedAt` unless
something else is being pushed too.

**Done when.** A sync test with only an in-progress session change makes no
commit, and the session still uploads along with the next answer.

### 13. Narrow what "Make Q-Bank Questions" lets Claude run

**Why.** `run_claude` in `mac-slides/make_questions.py` allows
`Bash(python3:*)`, i.e. any Python, while Claude reads slide files. A slide
deck containing hostile instructions could run code on the Mac.

**How.** Replace `Bash(python3:*)` with the one command the skill needs, the
validator: `Bash(python3 <absolute path>/validate_qbank.py:*)`, building the
path from the skill's installed location (`~/.claude/skills/qbank-generator`,
linked by `install.sh`). Run a real lecture through the Finder action to
confirm it still validates, and check `~/Library/Logs/Q-Bank Questions.log`
for permission denials. Rerun `mac-slides/install.sh` afterwards.

**Done when.** A lecture still produces a validated file, and
`mac-slides/test_make_questions.py` passes.

### 14. Clear the remaining dependency advisories

**Why.** `npm audit` in the app still reports 6 low/moderate advisories, all
inside `vite-plugin-pwa`'s build-time dependencies (nothing that ships to the
browser). `npm audit fix --force` would downgrade `vite-plugin-pwa` to 1.x,
which is a breaking change.

**How.** Every month or so run `npm outdated` and `npm audit` in both the root
and `connector/`. When a `vite-plugin-pwa` release clears them, upgrade, run
the checks at the top of this file, and confirm in the built app that the
service worker registers and the "new version available" prompt
(`src/components/UpdateToast.tsx`) still appears after a second build.

**Done when.** `npm audit` reports 0 in both folders with no `--force`.
