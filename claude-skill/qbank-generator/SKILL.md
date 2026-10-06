---
name: qbank-generator
description: Writes USMLE Step 1 / NBME-style practice questions from medical school lecture slides and delivers them as a Q-Bank import file (.json). Use whenever the user attaches lecture slides or notes and asks for practice questions, Q-Bank questions, or a day file, or names a lecture day such as "Week 6 Day 2" or "B2 W6 D2".
---

# Q-Bank question generator

You turn one lecture day's slides into a single JSON file the user imports into
their Q-Bank app. The app is strict about the format, and it shuffles answer
options, so follow this exactly.

## 1. Pin down the day

You need: **course name** (e.g. "Block 2"), **course code** for IDs (e.g. "B2"),
**week**, **day**, **date** (YYYY-MM-DD), and **day label**
(e.g. "Week 6 – Day 2 (Tue Oct 6)").

- Take what the user said ("B2 Week 6 Day 2", "Block 2, W6D2").
- Infer the rest from the slides, file names, or earlier messages. If the date
  isn't given, use today's date. Build the day label as
  `Week <w> – Day <d> (<Ddd Mmm D>)`.
- If the course, week, or day still isn't clear, ask ONE short question that
  lists only what's missing. Don't ask about anything you can infer.

## 2. Read everything first

Read every attached file completely before writing. For each lecture, note the
title, lecturer, stated learning objectives (copy them verbatim if listed), and
which slides cover what. Lectures are numbered L1, L2, … in the order they
occurred that day.

Lecture length: use what the user says; otherwise assume 1 hour per lecture
(~40–60 slides). Write **8–15 questions per hour**, scaled to how dense the
content is, and **at least one question for every learning objective**.

If the user pasted a list of existing questions ("qid | stem"), don't reuse
those qids and don't test the same fact the same way.

## 3. Write the file

Follow `reference/format.md` exactly (structure, ID rules, field rules). The
formal JSON Schema is `reference/qbank-schema.json`.

Question standards (NBME style):
- About 60–70% clinical vignettes (age, sex, complaint, history, exam, labs →
  a clear question). The rest are mechanism and lab_interpretation; recall only
  for facts that can't sensibly be tested another way.
- Exactly 5 options, ids "A"–"E", one best answer. All options the same kind
  of thing (all drugs, all enzymes, all nerves…), plausible, and similar length.
- The lead-in must be answerable with the options covered.
- Never "all/none of the above", "both A and B", or negative stems
  ("Which is NOT…", "…EXCEPT").
- Test understanding and application, not slide trivia. Give normal ranges for
  lab values that aren't commonly memorized.
- Every answer must be supported by the lecture. Use background knowledge only
  to build a realistic vignette.
- Spread questions across the whole lecture; use mostly difficulty 2–4.

Explanations:
- `explanation`: 3–6 sentences teaching the concept (why the answer is right,
  plus the underlying physiology/pathology/pharmacology).
- Every option gets its own `explanation`: why it's right, or why it's wrong
  here and when it WOULD be the answer.
- **Never refer to an option by its letter** anywhere ("A is wrong", "unlike
  choice C"). The app shuffles options, so refer to them by content.
- `key_takeaway`: one high-yield sentence.

## 4. Validate, fix, repeat

Save the file, then run:

```bash
python3 scripts/validate_qbank.py <file.json>
```

Fix every **ERROR** and re-run until it reports none. Then fix the
**WARNINGS** that point to real problems: uncovered objectives (write the
missing questions), lopsided answer letters (rebalance which option is
correct), or too few questions for a lecture. Re-run after changes.

If you can't run code, check the same things by hand against
`reference/format.md` before replying.

## 5. Deliver

- Name the file `<CODE>_W<week>_D<day>_<date>.json`, e.g.
  `B2_W6_D2_2026-10-06.json`, and save it in the outputs folder
  (e.g. `/mnt/user-data/outputs/`) so the user gets a download link.
- If you can't create files, reply with ONE ```json code block containing the
  complete file and nothing else.
- After the file, add one short line: lectures covered, number of questions,
  and the validator result. Don't paste the questions into the chat.

If the content is too long for one reply, ask the user whether to split the day
into two files (e.g. L1–L2, then L3–L4). Never truncate the JSON.
