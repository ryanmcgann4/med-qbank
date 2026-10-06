# Q-Bank file format

One JSON object per lecture day. It must parse with `JSON.parse`: double
quotes only, no comments, no trailing commas, no `...` placeholders.

```json
{
  "format_version": "1.0",
  "generated_at": "2026-10-06T18:00:00-05:00",
  "course": "Block 2",
  "week": 6,
  "day_label": "Week 6 – Day 2 (Tue Oct 6)",
  "date": "2026-10-06",
  "lectures": [
    {
      "lecture_id": "B2-W6-D2-L1",
      "title": "Renal Tubular Physiology II",
      "lecturer": "Dr. Smith",
      "summary": "2–4 sentences on what the lecture covers.",
      "learning_objectives": ["Describe ...", "Explain ..."]
    }
  ],
  "questions": [
    {
      "qid": "B2-W6-D2-L1-Q001",
      "lecture_id": "B2-W6-D2-L1",
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
      "source": { "slides": "12-14", "objective": "Explain ..." },
      "tags": ["renal", "physiology", "loop-of-henle"],
      "image_url": null
    }
  ]
}
```

## Field rules

| Field | Rule |
| --- | --- |
| `format_version` | `"1.0"` |
| `generated_at` | Current ISO 8601 timestamp with UTC offset |
| `course` | Course name, e.g. `"Block 2"` |
| `week` | Integer |
| `day_label` | e.g. `"Week 6 – Day 2 (Tue Oct 6)"` |
| `date` | `YYYY-MM-DD` |
| `lecture_id` | `<CODE>-W<week>-D<day>-L<n>`, n = 1, 2, 3… in lecture order |
| `summary` | 2–4 sentences |
| `learning_objectives` | The lecture's stated objectives, verbatim if listed; otherwise write 3–8 |
| `qid` | `<lecture_id>-Q<nnn>`: 3 digits, restarting at Q001 for each lecture. Unique. |
| `type` | One of `clinical_vignette`, `mechanism`, `recall`, `lab_interpretation`, `image_based`. Don't use `image_based`; describe images in words instead. |
| `difficulty` | Integer 1–5 (3 = typical Step 1); mostly 2–4 |
| `options` | Exactly 5, ids `"A"`–`"E"`, each with non-empty `text` and `explanation` |
| `correct_option` | The id of the single best answer |
| `source.slides` | String: `"12"` or `"12-14"` |
| `source.objective` | The learning objective tested, copied exactly from that lecture's `learning_objectives` |
| `tags` | 2–5 lowercase tags: system, discipline, topic. Add `from-lecture` to questions rewritten from practice questions on the slides. |
| `image_url` | Always `null` |

Copying `source.objective` exactly matters: the app matches it to the lecture's
objectives to show which ones have no questions.
