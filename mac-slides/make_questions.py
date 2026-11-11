#!/usr/bin/python3
"""
"Make Q-Bank Questions" (Finder → right-click a lecture or day folder → Quick Actions).

Opens the Q-Bank Questions window (QBankQuestions.swift) to check and adjust what gets made:
which lectures and files, how many questions, their style, the lecture each lands in and its
Library folder. Then for each lecture folder (Week N/<n Day>/<Lecture>/): convert its decks to
PDF with PowerPoint (so page N is slide N), have Claude Code write and check the questions with
the qbank-generator skill, and add them to the bank through the sync repo
(scripts/qbank-local.ts). The window shows progress; Q-Bank picks them up on its next sync.

The window and this script talk through files in a work folder:
  plan.json     (script → window) the day's lectures, files, bank lectures and folders
  options.json  (window → script) what you chose; the window exiting without it means Cancel
  status.json   (script → window) progress per lecture
  stop          (window → script) stop after the current step
"""
import datetime, json, os, re, shutil, subprocess, sys, threading, time, zipfile
from common import DAYS, DECKS, load, numbers, notify, overlap, save, words

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QLOG = os.path.expanduser("~/Library/Logs/Q-Bank Questions.log")
WORK = os.path.expanduser("~/Library/Caches/Q-Bank Questions")
PPT_TMP = os.path.expanduser("~/Library/Containers/com.microsoft.Powerpoint/Data/tmp/qbank")
GUI = os.path.expanduser("~/Applications/Q-Bank Questions.app/Contents/MacOS/QBankQuestions")
SOURCES = DECKS + (".pdf",)
ENV = {**os.environ, "PATH": f"{os.path.expanduser('~/.local/bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"}
TITLE = "Q-Bank Questions"
OPTIONS = "question-options.json"
CLAUDE_TIMEOUT = 45 * 60

# Settings that apply to every lecture. "count" 0 = let Claude decide (8–15 per hour of lecture).
DEFAULTS = {
    "count": 0,
    "difficulty": "exam",  # easier | exam | harder
    "style": "vignettes",  # vignettes | mixed | concepts
    "yield_focus": "balanced",  # balanced | high
    "practice": True,  # rewrite the practice questions on the slides
    "notes": "",
    "model": "",  # "" = Claude Code's default, or opus / sonnet
    "add_to_bank": True,
    "remember": True,
}


def qlog(msg):
    os.makedirs(os.path.dirname(QLOG), exist_ok=True)
    with open(QLOG, "a") as f:
        f.write(f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")


def write_json(path, value):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(value, f, indent=1)
    os.replace(tmp, path)


def course_code(course):
    m = re.match(r"\s*([A-Za-z])[A-Za-z]*\s*(\d+)", course)
    return f"{m.group(1).upper()}{m.group(2)}" if m else course.replace(" ", "")


def locate(folder):
    """(course, root, week, day, lecture folder or None) for a folder inside a course's Week N/<n Day>/."""
    folder = os.path.abspath(folder)
    for course, root in load("config.json", {}).get("courses", {}).items():
        rel = os.path.relpath(folder, root)
        if rel.startswith(".."):
            continue
        parts = rel.split(os.sep)
        m = re.match(r"Week (\d+)$", parts[0]) if parts else None
        if not m or len(parts) < 2 or parts[1] not in DAYS:
            break
        return course, root, int(m.group(1)), DAYS.index(parts[1]) + 1, (parts[2] if len(parts) > 2 else None)
    raise ValueError(f"{folder} isn't a Week N / day folder inside a course folder in Settings.")


def day_info(course, week, day):
    wk = load("schedule.json", {}).get(course, {}).get(str(week))
    if not wk:
        raise ValueError(f"Week {week} of {course} isn't in the schedule (run parse_schedule.py with the Canvas page).")
    date = datetime.date.fromisoformat(wk["monday"]) + datetime.timedelta(days=day - 1)
    return date, wk["days"].get(str(day), [])


def calendar_title(folder_name, items):
    best = max(items, key=lambda i: (i["folder"] == folder_name, overlap(words(folder_name), words(i["title"]))), default=None)
    return best["title"] if best and (best["folder"] == folder_name or overlap(words(folder_name), words(best["title"])) >= 1) else folder_name


def to_pdf(deck, out):
    """Save a PowerPoint deck as PDF (one page per slide). Office is sandboxed, so it writes inside its own container first."""
    os.makedirs(PPT_TMP, exist_ok=True)
    tmp = os.path.join(PPT_TMP, os.path.splitext(os.path.basename(deck))[0] + ".pdf")
    if os.path.exists(tmp):
        os.remove(tmp)
    script = f'''
    tell application "Microsoft PowerPoint"
        set wasOpen to false
        try
            repeat with p in presentations
                if (full name of p) is {json.dumps(deck)} then set wasOpen to true
            end repeat
        end try
        open POSIX file {json.dumps(deck)}
        delay 1
        save active presentation in POSIX file {json.dumps(tmp)} as save as PDF
        if not wasOpen then close active presentation saving no
    end tell'''
    subprocess.run(["osascript", "-e", script], check=True, capture_output=True, text=True)
    for _ in range(60):
        if os.path.exists(tmp) and os.path.getsize(tmp) > 0:
            break
        time.sleep(1)
    shutil.move(tmp, out)


def bank_context(course, week, date, day_label):
    out = subprocess.run(
        ["npx", "tsx", "scripts/qbank-local.ts", "context", "--course", course, "--week", str(week), "--date", date.isoformat(), "--day-label", day_label],
        cwd=REPO_DIR, env={**ENV, "QBANK_REPO": load("config.json", {}).get("syncRepo", "")}, check=True, capture_output=True, text=True,
    )
    return json.loads(out.stdout)


def same_lecture(a, b):
    """Whether two titles name the same lecture. Lectures on one day often share words ("Cell Injury" /
    "Cell Adaptations", or "Kidney Physiology: …" for several), so nearly all the words of each must match."""
    if numbers(a) != numbers(b):
        return False  # "Case Studies 1" isn't "Case Studies 2"
    wa, wb = words(a), words(b)
    if not wa or not wb:
        return a.strip().lower() == b.strip().lower()
    return overlap(wa, wb) >= 0.8 * len(wa) and overlap(wb, wa) >= 0.8 * len(wb)


def next_lecture_id(code, week, day, used):
    prefix = f"{code}-W{week}-D{day}-L"
    nums = [int(i[len(prefix):]) for i in used if i.startswith(prefix) and i[len(prefix):].isdigit()]
    return f"{prefix}{max(nums, default=0) + 1}"


def lecture_id_for(code, week, day, title, ctx):
    """Reuse the bank's id if this lecture is already there; else the next free L number for the day."""
    for l in ctx["lectures"]:
        if same_lecture(title, l["title"]):
            return l["lecture_id"], True
    return next_lecture_id(code, week, day, ctx["all_lecture_ids"]), False


def page_count(path):
    """Slides in a deck or pages in a PDF, if it's quick to tell."""
    try:
        if path.lower().endswith(".pptx"):
            with zipfile.ZipFile(path) as z:
                return sum(1 for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n))
        if path.lower().endswith(".pdf"):
            out = subprocess.run(["mdls", "-raw", "-name", "kMDItemNumberOfPages", path], capture_output=True, text=True, timeout=5).stdout.strip()
            return int(out) if out.isdigit() else None
    except Exception:  # noqa: BLE001 - a count is a nice-to-have
        return None
    return None


def source_files(folder):
    return sorted(f for f in os.listdir(folder) if f.lower().endswith(SOURCES) and not f.startswith((".", "~$")))


def lecture_folders(day_folder):
    return [os.path.join(day_folder, n) for n in sorted(os.listdir(day_folder)) if os.path.isdir(os.path.join(day_folder, n)) and not n.startswith(".")]


# ---------------------------------------------------------------------------- planning


def make_plan(course, week, day, chosen, defaults):
    """Everything the window shows for one day: every lecture folder that day (the ones you
    right-clicked are ticked), its files, the bank's lectures for the day, and Library folders."""
    root = load("config.json", {}).get("courses", {})[course]
    day_folder = os.path.join(root, f"Week {week}", DAYS[day - 1])
    date, items = day_info(course, week, day)
    code = course_code(course)
    day_label = f"Week {week} – Day {day} ({date:%a %b} {date.day})"
    ctx = bank_context(course, week, date, day_label)
    lectures = []
    for path in lecture_folders(day_folder):
        name = os.path.basename(path)
        title = calendar_title(name, items)
        match = next((l["lecture_id"] for l in ctx["lectures"] if same_lecture(title, l["title"])), None)
        files = [{"name": f, "kind": f.rsplit(".", 1)[-1].lower(), "pages": page_count(os.path.join(path, f))} for f in source_files(path)]
        lectures.append({"key": name, "path": path, "folder_name": name, "title": title, "files": files, "match": match, "selected": path in chosen and bool(files)})
    return {
        "course": course, "code": code, "week": week, "day": day, "date": date.isoformat(), "day_label": day_label, "day_path": day_folder,
        "lectures": lectures,
        "bank_lectures": [{k: l[k] for k in ("lecture_id", "title", "questions", "folder_id", "folder_path")} for l in ctx["lectures"]],
        "folders": ctx.get("folders", []),
        "day_folder": ctx.get("day_folder"),
        "defaults": defaults,
        "ctx": ctx,
    }


def default_options(plan):
    """What you'd get without the window: the ticked lectures, all files, settings as last used."""
    g = plan["defaults"]
    return {
        "global": g,
        "lectures": [
            {"key": l["key"], "include": l["selected"], "title": l["title"], "target": l["match"] or "new", "count": g["count"],
             "files": [f["name"] for f in l["files"]], "folder": "", "new_folder": ""}
            for l in plan["lectures"]
        ],
    }


# ---------------------------------------------------------------------------- the prompt

DIFFICULTY = {
    "easier": "Make them easier than usual: mostly difficulty 1–3, one-step questions that check the core facts and concepts.",
    "harder": "Make them harder than usual: mostly difficulty 3–5, multi-step vignettes where the answer takes two or three inferences.",
}
STYLE = {
    "mixed": "Use a balanced mix: about 40% clinical vignettes, the rest mechanism and lab_interpretation questions (recall only where nothing else fits).",
    "concepts": "Focus on concepts: mostly mechanism questions with short stems, about 25% clinical vignettes, and lab_interpretation where it fits.",
}


def build_prompt(*, course, code, week, day, date, day_label, title, lecture_id, existing, inputs, out_name, opts, count):
    lines = [
        "Use the qbank-generator skill to write a Q-Bank day file for ONE lecture, without asking me anything.",
        "",
        f'- Course "{course}" (code {code}), Week {week}, Day {day}, date {date}, day label "{day_label}".',
        f'- The lecture is "{title}". Use exactly that as its title, and lecture_id "{lecture_id}" for it, so qids are {lecture_id}-Q001, -Q002, …',
        f"- Its files are here: {', '.join(json.dumps(i) for i in inputs)}. Files ending \"(slides).pdf\" are PowerPoint decks saved as PDF: page N is slide N, so cite those slides as plain numbers (\"12\" or \"12-13\"). For other PDFs, cite the kind of document and page, e.g. \"handout p2\", \"key points p1\", \"video slide 5\", \"practice questions p3\".",
        "- existing.json lists what's already in the bank for this day."
        + (" This lecture is already there: don't repeat any of its questions (same fact tested the same way) and don't reuse its qids; number new ones after the highest existing one." if existing else ""),
    ]
    if count:
        lines.append(
            f"- Write exactly {count} {'new ' if existing else ''}question{'' if count == 1 else 's'} for this lecture. This replaces the skill's 8–15 per hour."
            " If there are more learning objectives than questions, cover the most testable ones, and ignore the validator's warnings about uncovered objectives or the number of questions."
        )
    if opts.get("difficulty") in DIFFICULTY:
        lines.append(f"- {DIFFICULTY[opts['difficulty']]}")
    if opts.get("style") in STYLE:
        lines.append(f"- {STYLE[opts['style']]}")
    if opts.get("yield_focus") == "high":
        lines.append(
            "- I'm short on time: write questions only on the lecture's high-yield material (what's most likely to be on the exam),"
            ' rate every question "high", and ignore the validator\'s warning about the high/low split.'
        )
    if not opts.get("practice", True):
        lines.append("- Skip the practice questions on the slides: don't rewrite them into questions.")
    notes = (opts.get("notes") or "").strip()
    if notes:
        lines.append(f"- Extra instructions from me: {notes}")
    lines.append(f'- Save the file as "{out_name}" in this folder, run the skill\'s validator on it, fix anything it reports, and finish by replying with just the file name.')
    return "\n".join(lines)


# ---------------------------------------------------------------------------- progress


class Status:
    """status.json for the window: one row per lecture you chose."""

    def __init__(self, work, rows):
        self.path = os.path.join(work, "status.json")
        self.stop_path = os.path.join(work, "stop")
        self.data = {"lectures": rows, "done": False, "summary": ""}
        self.lock = threading.Lock()
        self.write()

    def write(self):
        with self.lock:
            write_json(self.path, self.data)

    def set(self, key, **kw):
        for row in self.data["lectures"]:
            if row["key"] == key:
                row.update(kw)
        self.write()

    def stopped(self):
        return os.path.exists(self.stop_path)

    def finish(self, summary):
        self.data.update(done=True, summary=summary)
        self.write()


class Stopped(Exception):
    pass


PHASES = [
    (lambda name, inp: name == "Skill", "Reading the question-writing skill"),
    (lambda name, inp: name == "Read" and str(inp.get("file_path", "")).endswith("existing.json"), "Checking what's already in your bank"),
    (lambda name, inp: name == "Read", "Reading the slides"),
    (lambda name, inp: name == "Write", "Writing the questions"),
    (lambda name, inp: name == "Bash" and "validate" in str(inp.get("command", "")), "Checking the questions"),
    (lambda name, inp: name == "Edit", "Fixing what the checker found"),
]


def count_questions(path):
    try:
        with open(path) as f:
            return len(json.load(f).get("questions", []))
    except (OSError, ValueError, AttributeError):
        return None


def run_claude(prompt, work, out_path, model, status, key):
    """Run Claude Code, turning its tool calls into progress. Returns (ok, message)."""
    cmd = ["claude", "-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits",
           "--allowedTools", "Read", "Write", "Edit", "Glob", "Grep", "Skill", "Bash(python3:*)", "Bash(ls:*)"]
    if model:
        cmd += ["--model", model]
    proc = subprocess.Popen(cmd, cwd=work, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    killed = []

    def watchdog():
        start = time.time()
        while proc.poll() is None:
            if status.stopped() or time.time() - start > CLAUDE_TIMEOUT:
                killed.append("stopped" if status.stopped() else "timed out")
                proc.terminate()
                return
            time.sleep(1)

    threading.Thread(target=watchdog, daemon=True).start()
    result, tail = None, []
    for line in proc.stdout:
        tail = (tail + [line])[-20:]
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") == "assistant":
            for c in ev.get("message", {}).get("content", []):
                if c.get("type") != "tool_use":
                    continue
                phase = next((p for test, p in PHASES if test(c.get("name"), c.get("input") or {})), None)
                if phase:
                    status.set(key, phase=phase, questions=count_questions(out_path))
        elif ev.get("type") == "user":  # a tool finished: the file may have new questions in it
            n = count_questions(out_path)
            if n is not None:
                status.set(key, questions=n)
        elif ev.get("type") == "result":
            result = ev
    proc.wait()
    err = proc.stderr.read()
    qlog(f"claude exit {proc.returncode}: {''.join(tail)[-2000:]} {err[-1500:]}")
    if killed:
        if killed[0] == "stopped":
            raise Stopped()
        return False, "Claude took too long (45 min) and was stopped."
    if not result or result.get("is_error") or not os.path.exists(out_path):
        msg = str((result or {}).get("result") or err or "see the log").strip()
        return False, msg[:200]
    return True, ""


# ---------------------------------------------------------------------------- one lecture


def make(plan, lec, lo, opts, lecture_id, existing, status, work_root):
    """Write and add the questions for one lecture. Returns a short result line."""
    key, title = lec["key"], lo["title"].strip() or lec["title"]
    code, week, day = plan["code"], plan["week"], plan["day"]
    files = [f for f in source_files(lec["path"]) if f in set(lo["files"])]
    if not files:
        status.set(key, state="failed", phase="", message="No files selected.")
        return f"{title}: no files selected"
    work = os.path.join(work_root, re.sub(r"[^A-Za-z0-9]+", "-", key)[:40] or "lecture")
    os.makedirs(work, exist_ok=True)
    qlog(f"start: {lec['path']} ({lecture_id}, {len(files)} files, options {json.dumps(opts)}, count {lo['count']})")

    status.set(key, state="working", phase="Preparing the slides")
    inputs = []
    for f in files:
        if status.stopped():
            raise Stopped()
        src = os.path.join(lec["path"], f)
        if f.lower().endswith(".pdf"):
            shutil.copy2(src, os.path.join(work, f))
            inputs.append(f)
        elif f.lower().endswith((".pptx", ".ppt")):
            pdf = os.path.splitext(f)[0] + " (slides).pdf"
            status.set(key, phase=f"Saving {f} as PDF in PowerPoint")
            to_pdf(src, os.path.join(work, pdf))
            inputs.append(pdf)
    write_json(os.path.join(work, "existing.json"), {k: v for k, v in plan["ctx"].items() if k not in ("folders", "day_folder")})
    out_name = f"{code}_W{week}_D{day}_{plan['date']}_{lecture_id.rsplit('-', 1)[1]}.json"
    out_path = os.path.join(work, out_name)
    prompt = build_prompt(
        course=plan["course"], code=code, week=week, day=day, date=plan["date"], day_label=plan["day_label"], title=title,
        lecture_id=lecture_id, existing=existing, inputs=inputs, out_name=out_name, opts=opts, count=lo["count"],
    )
    status.set(key, phase="Starting Claude")
    ok, msg = run_claude(prompt, work, out_path, opts.get("model") or "", status, key)
    if not ok:
        status.set(key, state="failed", phase="", message=f"Couldn't write the questions: {msg}")
        return f"{title}: failed"
    n = count_questions(out_path) or 0
    shutil.copy2(out_path, os.path.join(plan["day_path"], out_name))  # keep the day file next to the lecture folders
    if not opts.get("add_to_bank", True):
        status.set(key, state="done", phase="", questions=n, message=f"Saved {out_name} in the day folder (not added to Q-Bank).")
        return f"{title}: {n} saved"

    status.set(key, phase="Adding to Q-Bank", questions=n)
    cmd = ["npx", "tsx", "scripts/qbank-local.ts", "import", out_path]
    default_folder = default_folder_for(plan, lo["target"])
    if lo.get("folder") and lo["folder"] != default_folder:
        cmd += ["--folder", lo["folder"]]
    if (lo.get("new_folder") or "").strip():
        cmd += ["--new-folder", lo["new_folder"].strip()]
    imp = subprocess.run(cmd, cwd=REPO_DIR, env={**ENV, "QBANK_REPO": load("config.json", {}).get("syncRepo", "")}, capture_output=True, text=True)
    qlog(f"import: {imp.stdout} {imp.stderr[-1500:]}")
    try:
        report = json.loads(imp.stdout)
    except ValueError:
        status.set(key, state="failed", phase="", message="Wrote the questions but couldn't add them. The file is in the day folder; import it in Q-Bank.")
        return f"{title}: not added"
    added, extra = report.get("imported", 0), []
    if report.get("already_in_bank"):
        extra.append(f"{report['already_in_bank']} already in your bank")
    if report.get("conflicts"):
        extra.append(f"{len(report['conflicts'])} clashed (import the file in the app to resolve)")
    status.set(key, state="done", phase="", questions=n, message=f"Added {added} question{'' if added == 1 else 's'}" + (f" ({'; '.join(extra)})" if extra else "") + ".")
    return f"{title}: {added} added"


def default_folder_for(plan, target):
    """Where an import files the lecture if you don't pick a folder: where it already is, or the day's folder."""
    bank = next((l for l in plan["bank_lectures"] if l["lecture_id"] == target), None)
    if bank:
        return bank["folder_id"] or "top"
    return (plan.get("day_folder") or {}).get("id", "")


# ---------------------------------------------------------------------------- the window


def run_day(course, week, day, chosen):
    os.makedirs(WORK, exist_ok=True)
    work = os.path.join(WORK, f"{datetime.datetime.now():%Y%m%d-%H%M%S}-{course_code(course)}-W{week}-D{day}")
    os.makedirs(work, exist_ok=True)
    defaults = {**DEFAULTS, **load(OPTIONS, {})}
    has_gui = os.path.exists(GUI)
    # Open the window first so you see it straight away; it waits for plan.json.
    proc = subprocess.Popen([GUI, work], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) if has_gui else None
    try:
        plan = make_plan(course, week, day, chosen, defaults)
    except Exception as e:  # noqa: BLE001
        write_json(os.path.join(work, "plan.json"), {"error": str(e)})
        raise
    write_json(os.path.join(work, "plan.json"), {k: v for k, v in plan.items() if k != "ctx"})
    if proc:
        opt_path = os.path.join(work, "options.json")
        while proc.poll() is None and not os.path.exists(opt_path):
            time.sleep(0.3)
        if not os.path.exists(opt_path):
            qlog(f"cancelled: {course} W{week} D{day}")
            return
        with open(opt_path) as f:
            chosen_opts = json.load(f)
    else:
        if not any(l["selected"] for l in plan["lectures"]):
            notify("No slides or PDFs in that folder.", TITLE)
            return
        notify("Writing questions. This takes a few minutes per lecture.", TITLE)
        chosen_opts = default_options(plan)

    opts = {**DEFAULTS, **chosen_opts.get("global", {})}
    if opts.get("remember", True):
        save(OPTIONS, {k: opts[k] for k in DEFAULTS if k not in ("notes",)})

    by_key = {l["key"]: l for l in plan["lectures"]}
    todo = [lo for lo in chosen_opts["lectures"] if lo.get("include") and lo["key"] in by_key]
    # Lecture ids up front, so two new lectures on the same day can't get the same one.
    used = list(plan["ctx"]["all_lecture_ids"])
    ids = {}
    for lo in todo:
        if lo["target"] != "new" and any(b["lecture_id"] == lo["target"] for b in plan["bank_lectures"]):
            ids[lo["key"]] = (lo["target"], True)
        else:
            new = next_lecture_id(plan["code"], week, day, used)
            used.append(new)
            ids[lo["key"]] = (new, False)
    status = Status(work, [{"key": lo["key"], "title": lo["title"], "lecture_id": ids[lo["key"]][0], "state": "queued", "phase": "", "questions": None, "message": ""} for lo in todo])

    results = []
    for i, lo in enumerate(todo):
        try:
            if status.stopped():
                raise Stopped()
            results.append(make(plan, by_key[lo["key"]], lo, opts, *ids[lo["key"]], status, work))
        except Stopped:
            for rest in todo[i:]:
                if next(r for r in status.data["lectures"] if r["key"] == rest["key"])["state"] in ("queued", "working"):
                    status.set(rest["key"], state="stopped", phase="", message="Stopped.")
            results.append("stopped")
            break
        except Exception as e:  # noqa: BLE001 - one lecture failing shouldn't stop the rest
            qlog(f"error for {lo['key']}: {e!r}")
            status.set(lo["key"], state="failed", phase="", message=str(e)[:200])
            results.append(f"{lo['title']}: failed")
    summary = "; ".join(results)
    status.finish(summary)
    notify(f"Done: {summary}. They'll show up in Q-Bank after it syncs." if opts.get("add_to_bank", True) else f"Done: {summary}.", TITLE)


def main(folders):
    groups = {}
    for folder in folders:
        try:
            course, root, week, day, lecture = locate(folder)
            targets = [os.path.abspath(folder)] if lecture else lecture_folders(os.path.abspath(folder))
            groups.setdefault((course, week, day), []).extend(targets)
        except Exception as e:  # noqa: BLE001 - tell the user rather than fail silently
            qlog(f"error for {folder}: {e!r}")
            notify(f"Couldn't make questions: {e}", TITLE)
    for (course, week, day), chosen in groups.items():
        try:
            run_day(course, week, day, set(chosen))
        except Exception as e:  # noqa: BLE001
            qlog(f"error for {course} W{week} D{day}: {e!r}")
            notify(f"Couldn't make questions: {e}", TITLE)


if __name__ == "__main__":
    main(sys.argv[1:])
