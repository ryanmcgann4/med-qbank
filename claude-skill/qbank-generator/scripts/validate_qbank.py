#!/usr/bin/env python3
"""Check a Q-Bank day file before handing it to the user.

Usage: python3 validate_qbank.py FILE.json

ERRORS would break the import or the app (fix all of them).
WARNINGS are quality problems worth fixing (missed objectives, lopsided keys).
Exit code 1 if there are errors.
"""
import json
import re
import sys
from collections import Counter

TYPES = {"clinical_vignette", "mechanism", "recall", "lab_interpretation", "image_based"}
LETTERS = ["A", "B", "C", "D", "E"]
LETTER_REF = re.compile(
    r"\b(?:option|choice|answer|letter)\s*\(?[A-E]\)?(?![\w-])"  # "option C", "choice (B)"
    r"|^\(?[A-E]\)?[.:)]?\s+(?:is|was|would)\b"  # "A is wrong because..."
    r"|\b[A-E]\s+is\s+(?:in)?correct\b",  # "... so C is correct"
    re.IGNORECASE | re.MULTILINE,
)
ALL_NONE = re.compile(r"\b(?:all|none|both) of the (?:above|options)\b|\bboth [A-E] and [A-E]\b", re.IGNORECASE)
NEGATIVE_STEM = re.compile(r"\bEXCEPT\b|\bNOT\b|\bLEAST likely\b")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
LECTURE_ID = re.compile(r"^[A-Za-z0-9]+-W\d+-D\d+-L\d+$")

errors = []
warnings = []


def err(where, msg):
    errors.append(f"{where}: {msg}")


def warn(where, msg):
    warnings.append(f"{where}: {msg}")


def text(v):
    return isinstance(v, str) and v.strip() != ""


def norm(s):
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s.lower()).split())


def check(data):
    if not isinstance(data, dict):
        err("file", "must be a JSON object")
        return 0
    if not (isinstance(data.get("format_version"), str) and re.match(r"^1\.\d+$", data["format_version"])):
        err("format_version", 'must be "1.0"')
    for k in ("course", "day_label"):
        if not text(data.get(k)):
            err(k, "missing or empty")
    if not (isinstance(data.get("week"), int) and not isinstance(data.get("week"), bool) and data["week"] >= 0):
        err("week", "must be a whole number")
    if not (isinstance(data.get("date"), str) and DATE.match(data["date"])):
        err("date", "must be YYYY-MM-DD")

    lectures = data.get("lectures")
    questions = data.get("questions")
    if not isinstance(lectures, list) or not lectures:
        err("lectures", "must be a non-empty list")
        lectures = []
    if not isinstance(questions, list) or not questions:
        err("questions", "must be a non-empty list")
        questions = []

    lecture_ids = {}
    for i, lec in enumerate(lectures):
        where = f"lectures[{i}]"
        if not isinstance(lec, dict):
            err(where, "must be an object")
            continue
        lid = lec.get("lecture_id")
        if not text(lid):
            err(where, "lecture_id missing")
            continue
        where = f"lecture {lid}"
        if lid in lecture_ids:
            err(where, "lecture_id used twice")
        if not LECTURE_ID.match(lid):
            warn(where, "lecture_id should look like B2-W6-D2-L1")
        if not text(lec.get("title")):
            err(where, "title missing")
        summary = lec.get("summary", "")
        n_sent = len([s for s in re.split(r"(?<=[.!?])\s+", summary.strip()) if s])
        if not text(summary):
            warn(where, "summary is empty (write 2-4 sentences)")
        elif not 2 <= n_sent <= 4:
            warn(where, f"summary has {n_sent} sentences (aim for 2-4)")
        objs = lec.get("learning_objectives", [])
        if not isinstance(objs, list) or not all(isinstance(o, str) for o in objs):
            err(where, "learning_objectives must be a list of strings")
            objs = []
        elif not objs:
            warn(where, "no learning_objectives")
        lecture_ids[lid] = objs

    qids = set()
    per_lecture = Counter()
    covered = {lid: set() for lid in lecture_ids}
    keys = Counter()
    for i, q in enumerate(questions):
        if not isinstance(q, dict):
            err(f"questions[{i}]", "must be an object")
            continue
        qid = q.get("qid") if text(q.get("qid")) else f"questions[{i}]"
        where = f"question {qid}"
        lid = q.get("lecture_id")
        if not text(q.get("qid")):
            err(where, "qid missing")
        elif qid in qids:
            err(where, "qid used twice")
        qids.add(qid)
        if lid not in lecture_ids:
            err(where, f'lecture_id "{lid}" is not in lectures')
        else:
            per_lecture[lid] += 1
            if text(q.get("qid")) and not re.match(re.escape(lid) + r"-Q\d{3}$", qid):
                err(where, f"qid must be {lid}-Q### (3 digits)")
        if q.get("type") not in TYPES:
            err(where, f'type "{q.get("type")}" must be one of {", ".join(sorted(TYPES))}')
        elif q["type"] == "image_based":
            warn(where, "avoid image_based; describe the image in the stem and use another type")
        d = q.get("difficulty")
        if not (isinstance(d, int) and not isinstance(d, bool) and 1 <= d <= 5):
            err(where, "difficulty must be a whole number 1-5")
        stem = q.get("stem")
        if not text(stem):
            err(where, "stem missing")
        elif NEGATIVE_STEM.search(stem):
            err(where, "negatively phrased stem (NOT / EXCEPT / LEAST likely); rewrite as a positive one-best-answer question")
        for k in ("explanation", "key_takeaway"):
            if not text(q.get(k)):
                err(where, f"{k} missing")

        opts = q.get("options")
        if not isinstance(opts, list):
            err(where, "options must be a list")
            opts = []
        ids = [o.get("id") if isinstance(o, dict) else None for o in opts]
        if ids != LETTERS:
            err(where, f"options must be exactly 5 with ids A-E in order (got {ids})")
        for o in opts:
            if not isinstance(o, dict):
                continue
            oid = o.get("id")
            if not text(o.get("text")):
                err(where, f"option {oid} text missing")
            elif ALL_NONE.search(o["text"]):
                err(where, f'option {oid} uses "all/none/both of the above"')
            if not text(o.get("explanation")):
                err(where, f"option {oid} needs its own explanation")
        if q.get("correct_option") not in ids:
            err(where, f'correct_option "{q.get("correct_option")}" is not one of the option ids')
        else:
            keys[q["correct_option"]] += 1

        # The app shuffles options, so letters in prose point at the wrong choice.
        prose = [q.get("explanation", ""), q.get("key_takeaway", "")] + [
            o.get("explanation", "") for o in opts if isinstance(o, dict)
        ]
        for p in prose:
            m = LETTER_REF.search(p or "")
            if m:
                err(where, f'refers to an option by letter ("{m.group(0).strip()}"); options are shuffled, so name the option by its content')
                break

        src = q.get("source")
        if not isinstance(src, dict) or not (text(src.get("slides")) or isinstance(src.get("slides"), int)):
            err(where, 'source.slides missing (e.g. "12-14")')
        elif lid in lecture_ids:
            obj = src.get("objective")
            if not text(obj):
                warn(where, "source.objective missing")
            else:
                objs = {norm(o): o for o in lecture_ids[lid]}
                if norm(obj) in objs:
                    covered[lid].add(norm(obj))
                elif objs:
                    warn(where, "source.objective doesn't exactly match any of the lecture's learning_objectives (copy it verbatim)")
        tags = q.get("tags", [])
        if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
            err(where, "tags must be a list of strings")
        elif not 2 <= len(tags) <= 5:
            warn(where, f"{len(tags)} tags (use 2-5)")
        if q.get("image_url") not in (None,):
            warn(where, "image_url should be null")

    for lid, objs in lecture_ids.items():
        if per_lecture[lid] == 0:
            err(f"lecture {lid}", "has no questions")
            continue
        if per_lecture[lid] < 6:
            warn(f"lecture {lid}", f"only {per_lecture[lid]} questions (aim for 8-15 per hour of lecture)")
        missing = [o for o in objs if norm(o) not in covered[lid]]
        if missing:
            warn(f"lecture {lid}", "objectives with no question: " + "; ".join(missing))

    total = sum(keys.values())
    if total >= 10:
        letter, n = keys.most_common(1)[0]
        if n / total > 0.35:
            warn("answer key", f"{n}/{total} answers are {letter}; spread the correct answer across A-E")
    return len(questions)


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    path = sys.argv[1]
    try:
        with open(path, encoding="utf-8") as f:
            raw = f.read()
    except OSError as e:
        print(f"ERROR: can't read {path}: {e}")
        sys.exit(1)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"ERROR: not valid JSON: {e}")
        sys.exit(1)
    n = check(data)
    for e in errors:
        print(f"ERROR   {e}")
    for w in warnings:
        print(f"WARNING {w}")
    lectures = len(data.get("lectures", [])) if isinstance(data, dict) else 0
    print(f"\n{n} questions, {lectures} lectures: {len(errors)} errors, {len(warnings)} warnings")
    print("OK: ready to import" if not errors else "Fix the errors and run again.")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
