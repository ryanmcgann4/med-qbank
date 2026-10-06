export interface PromptInputs {
  /** e.g. "Block 2" */
  course: string;
  /** Short code used in IDs and the file name, e.g. "B2" */
  code: string;
  week: string;
  day: string;
  /** YYYY-MM-DD */
  date: string;
  /** e.g. "Week 6 – Day 1 (Mon Oct 5)" */
  dayLabel: string;
  /** Optional free text, e.g. "L1 50 min, L2 50 min, L3 is a 2-hour TBL" */
  lectureNotes: string;
  /** Optional list of existing questions ("qid | stem…") to avoid duplicating. */
  existing: string;
}

const blank = (v: string, placeholder: string) => (v.trim() ? v.trim() : `[${placeholder}]`);

export function suggestedDayLabel(week: string, day: string, date: string): string {
  if (!week || !day) return '';
  let suffix = '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const d = new Date(date + 'T00:00:00');
    suffix = ` (${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')})`;
  }
  return `Week ${week} – Day ${day}${suffix}`;
}

export function fileNameFor(i: Pick<PromptInputs, 'code' | 'week' | 'day' | 'date'>): string {
  return `${blank(i.code, 'CODE')}_W${blank(i.week, 'WEEK')}_D${blank(i.day, 'DAY')}_${blank(i.date, 'YYYY-MM-DD')}.json`;
}

export function buildGeneratorPrompt(i: PromptInputs): string {
  const code = blank(i.code, 'COURSE CODE, e.g. B2');
  const week = blank(i.week, 'WEEK #');
  const day = blank(i.day, 'DAY #');
  const date = blank(i.date, 'YYYY-MM-DD');
  const course = blank(i.course, 'COURSE NAME, e.g. Block 2');
  const dayLabel = blank(i.dayLabel, 'DAY LABEL, e.g. Week 6 – Day 1 (Mon Oct 5)');
  const fileName = fileNameFor(i);
  const idPrefix = `${code}-W${week}-D${day}`;
  const weekJson = /^\d+$/.test(i.week.trim()) ? i.week.trim() : '<week number>';

  const existing = i.existing.trim()
    ? `These questions are already in my bank. Do not reuse any of these qids, and do not write a question that tests the same fact in the same way as any of them (a different angle on the same objective is fine):\n\n${i.existing.trim()}`
    : 'None provided.';

  return `You are writing USMLE Step 1 / NBME-style practice questions from my medical school lecture slides (attached). I'm a first-year medical student; your output will be imported straight into my Q-bank app, so the format must be exact.

## This lecture day
- Course: ${course}
- Course code (for IDs and the file name): ${code}
- Week: ${week}
- Day: ${day}
- Date: ${date}
- Day label: ${dayLabel}
- Lecture lengths: ${i.lectureNotes.trim() || 'not given; assume each lecture is about 1 hour'}

If any value above is still in [brackets], infer it from the attached files. If you can't infer it confidently, ask me before writing any questions.

## Output: ONE JSON file, nothing else
- Create a downloadable file named exactly: ${fileName}
- If you can't create files, reply with ONE \`\`\`json code block containing the complete file, with no text before or after it.
- It must parse with JSON.parse: double quotes only, no comments, no trailing commas, no "..." placeholders, and never truncated. If the day has a lot of content, still write every question; don't stop early or summarize.

## Exact structure
{
  "format_version": "1.0",
  "generated_at": "<current ISO 8601 timestamp with UTC offset>",
  "course": "${course}",
  "week": ${weekJson},
  "day_label": "${dayLabel}",
  "date": "${date}",
  "lectures": [
    {
      "lecture_id": "${idPrefix}-L1",
      "title": "<lecture title as on the title slide>",
      "lecturer": "<lecturer name, or empty string>",
      "summary": "<2–4 sentence summary of what the lecture covers>",
      "learning_objectives": ["<objective 1>", "<objective 2>"]
    }
  ],
  "questions": [
    {
      "qid": "${idPrefix}-L1-Q001",
      "lecture_id": "${idPrefix}-L1",
      "type": "clinical_vignette",
      "difficulty": 3,
      "stem": "A 54-year-old man presents with ... Which of the following is the most likely ...?",
      "options": [
        { "id": "A", "text": "...", "explanation": "Why this option is right or wrong." },
        { "id": "B", "text": "...", "explanation": "..." },
        { "id": "C", "text": "...", "explanation": "..." },
        { "id": "D", "text": "...", "explanation": "..." },
        { "id": "E", "text": "...", "explanation": "..." }
      ],
      "correct_option": "C",
      "explanation": "Full teaching explanation of the concept being tested.",
      "key_takeaway": "One-line high-yield fact.",
      "source": { "slides": "12-14", "objective": "<the learning objective this question tests>" },
      "tags": ["renal", "physiology", "pct"],
      "image_url": null
    }
  ]
}

## Field rules
- lecture_id: ${idPrefix}-L<n>, numbering lectures 1, 2, 3… in the order they occurred that day.
- qid: <lecture_id>-Q<nnn>, zero-padded to 3 digits and restarting at Q001 for each lecture (e.g. ${idPrefix}-L2-Q007). Every qid must be unique.
- type: one of "clinical_vignette", "mechanism", "recall", "lab_interpretation", "image_based". Don't use "image_based"; describe imaging, histology, or gross findings in words in the stem instead.
- difficulty: integer 1–5 (3 = a typical Step 1 question). Use mostly 2–4.
- options: exactly 5, with ids "A" through "E". correct_option is the id of the single best answer.
- source.slides: the slide number(s) the question is based on, as a string, e.g. "12" or "12-14". source.objective: the learning objective it tests.
- tags: 2–5 short lowercase tags: organ system, discipline, and specific topic (e.g. "renal", "pharmacology", "loop-diuretics").
- image_url: always null.

## Lecture summaries
For each lecture: summary = 2–4 sentences on what it covers. learning_objectives = the lecture's stated objectives, copied as written if the slides list them; otherwise write 3–8 in "Describe / Explain / Predict…" form.

## Question standards (NBME style)
- Mostly clinical vignettes (about 60–70%): age, sex, presenting complaint, relevant history, exam, and labs, then a clear question (most likely diagnosis, mechanism, next step, expected finding, drug of choice, etc.). Fill the rest with mechanism and lab_interpretation questions; use recall only for facts that can't sensibly be tested any other way.
- One best answer. All five options must be the same kind of thing (all drugs, all enzymes, all nerves…), plausible, and similar in length and specificity.
- The lead-in must be answerable with the options covered.
- Never use "all of the above", "none of the above", "both A and B", or negatively phrased stems ("Which is NOT…", "…EXCEPT").
- Test understanding and application, not slide trivia. Give normal ranges for lab values that aren't commonly memorized.
- Every answer must be supported by the lecture content. Use standard background knowledge only to build a realistic vignette.

## Explanations
- explanation: a full teaching explanation (about 3–6 sentences): why the answer is correct and the underlying physiology, pathology, or pharmacology.
- Every option gets its own explanation. For the correct option, say why it's right. For each distractor, say why it's wrong here and, where useful, the scenario in which it WOULD be the answer.
- Never refer to options by letter anywhere ("A is wrong because…", "unlike choice C…"). My app shuffles the option order, so refer to options by their content.
- key_takeaway: one high-yield sentence.

## Practice questions on the slides
If the slides include practice questions (check-your-understanding, clicker, board-style examples), include every one: rewrite it into this format (5 options, every option explained), keep the professor's intended answer (or work it out from the lecture and say so), cite that slide, and add the tag "from-lecture".

## Coverage and quantity
- Cover EVERY learning objective of every lecture with at least one question.
- Write about 8–15 questions per hour of lecture, scaled to how dense the content is.
- Spread questions across the whole lecture rather than clustering on the first slides.

## Avoid duplicates
${existing}

## Check before you output
- The JSON is complete and valid.
- Every question has exactly 5 options, each with an explanation, and correct_option matches one of them.
- Every question's lecture_id appears in "lectures"; qids are unique and follow the pattern.
- Every learning objective is covered, and no explanation refers to an option by letter.
- The file is named ${fileName}.`;
}
