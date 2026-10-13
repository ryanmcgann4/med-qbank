#!/usr/bin/python3
"""
"Make Q-Bank Questions" (Finder → right-click a lecture or day folder → Quick Actions).

For each lecture folder (Week N/<n Day>/<Lecture>/): convert its decks to PDF with
PowerPoint (so page N is slide N), have Claude Code write and check the questions
with the qbank-generator skill, then add them to the bank through the sync repo
(scripts/qbank-local.ts). Q-Bank picks them up on its next sync.
"""
import datetime, glob, json, os, re, shutil, subprocess, sys, time
from common import DAYS, DECKS, load, log, notify, numbers, overlap, words

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QLOG = os.path.expanduser("~/Library/Logs/Q-Bank Questions.log")
WORK = os.path.expanduser("~/Library/Caches/Q-Bank Questions")
PPT_TMP = os.path.expanduser("~/Library/Containers/com.microsoft.Powerpoint/Data/tmp/qbank")
SOURCES = DECKS + (".pdf",)
ENV = {**os.environ, "PATH": f"{os.path.expanduser('~/.local/bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"}
TITLE = "Q-Bank Questions"


def qlog(msg):
    os.makedirs(os.path.dirname(QLOG), exist_ok=True)
    with open(QLOG, "a") as f:
        f.write(f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")


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


def bank_context(course, date):
    out = subprocess.run(
        ["npx", "tsx", "scripts/qbank-local.ts", "context", "--course", course, "--date", date.isoformat()],
        cwd=REPO_DIR, env={**ENV, "QBANK_REPO": load("config.json", {}).get("syncRepo", "")}, check=True, capture_output=True, text=True,
    )
    return json.loads(out.stdout)


def lecture_id_for(code, week, day, title, ctx):
    """Reuse the bank's id if this lecture is already there; else the next free L number for the day."""
    for l in ctx["lectures"]:
        if numbers(title) and numbers(l["title"]) and not numbers(title) & numbers(l["title"]):
            continue  # "Case Studies 1" isn't "Case Studies 2"
        if overlap(words(title), words(l["title"])) >= max(1, 0.5 * len(words(title))):
            return l["lecture_id"], True
    prefix = f"{code}-W{week}-D{day}-L"
    used = [int(i[len(prefix):]) for i in ctx["all_lecture_ids"] if i.startswith(prefix) and i[len(prefix):].isdigit()]
    return f"{prefix}{max(used, default=0) + 1}", False


def make(folder):
    course, root, week, day, lecture = locate(folder)
    date, items = day_info(course, week, day)
    code = course_code(course)
    title = calendar_title(lecture, items)
    files = sorted(f for f in os.listdir(folder) if f.lower().endswith(SOURCES) and not f.startswith((".", "~$")))
    if not files:
        notify(f"No slides or PDFs in “{lecture}”.", TITLE)
        return
    notify(f"Writing questions for “{title}”. This takes a few minutes.", TITLE)
    qlog(f"start: {folder} ({code} W{week} D{day} {date}, {len(files)} files)")

    work = os.path.join(WORK, f"{code}-W{week}-D{day}-{re.sub(r'[^A-Za-z0-9]+', '-', lecture)[:40]}")
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    inputs = []
    for f in files:
        src = os.path.join(folder, f)
        if f.lower().endswith(".pdf"):
            shutil.copy2(src, os.path.join(work, f))
            inputs.append(f)
        elif f.lower().endswith((".pptx", ".ppt")):
            pdf = os.path.splitext(f)[0] + " (slides).pdf"
            to_pdf(src, os.path.join(work, pdf))
            inputs.append(pdf)
    ctx = bank_context(course, date)
    lecture_id, existing = lecture_id_for(code, week, day, title, ctx)
    json.dump(ctx, open(os.path.join(work, "existing.json"), "w"), indent=1)
    day_label = f"Week {week} – Day {day} ({date:%a %b} {date.day})"
    out_name = f"{code}_W{week}_D{day}_{date.isoformat()}_{lecture_id.rsplit('-', 1)[1]}.json"
    prompt = f"""Use the qbank-generator skill to write a Q-Bank day file for ONE lecture, without asking me anything.

- Course "{course}" (code {code}), Week {week}, Day {day}, date {date.isoformat()}, day label "{day_label}".
- The lecture is "{title}". Use lecture_id "{lecture_id}" for it, so qids are {lecture_id}-Q001, -Q002, …
- Its files are here: {", ".join(f'"{i}"' for i in inputs)}. Files ending "(slides).pdf" are PowerPoint decks saved as PDF: page N is slide N, so cite those slides as plain numbers ("12" or "12-13"). For other PDFs, cite the kind of document and page, e.g. "handout p2", "key points p1", "video slide 5", "practice questions p3".
- existing.json lists what's already in the bank for this day.{" This lecture is already there: don't repeat any of its questions (same fact tested the same way) and don't reuse its qids; number new ones after the highest existing one." if existing else ""}
- Save the file as "{out_name}" in this folder, run the skill's validator on it, fix anything it reports, and finish by replying with just the file name."""
    qlog(f"claude: {lecture_id} → {out_name}")
    run = subprocess.run(
        ["claude", "-p", prompt, "--output-format", "json", "--permission-mode", "acceptEdits",
         "--allowedTools", "Read", "Write", "Edit", "Glob", "Grep", "Skill", "Bash(python3:*)", "Bash(ls:*)"],
        cwd=work, env=ENV, capture_output=True, text=True, timeout=45 * 60,
    )
    qlog(f"claude exit {run.returncode}: {run.stdout[-2000:]} {run.stderr[-2000:]}")
    try:
        result = json.loads(run.stdout)
    except ValueError:
        result = {"is_error": True, "result": run.stderr or run.stdout}
    out_path = os.path.join(work, out_name)
    if result.get("is_error") or not os.path.exists(out_path):
        msg = str(result.get("result", ""))[:150]
        notify(f"Couldn't make questions for “{title}”: {msg or 'see ~/Library/Logs/Q-Bank Questions.log'}", TITLE)
        return
    imp = subprocess.run(
        ["npx", "tsx", "scripts/qbank-local.ts", "import", out_path],
        cwd=REPO_DIR, env={**ENV, "QBANK_REPO": load("config.json", {}).get("syncRepo", "")}, capture_output=True, text=True,
    )
    qlog(f"import: {imp.stdout} {imp.stderr[-1500:]}")
    shutil.copy2(out_path, os.path.join(os.path.dirname(folder), out_name))  # keep the day file next to the lecture folders
    try:
        report = json.loads(imp.stdout)
    except ValueError:
        notify(f"Wrote the questions for “{title}” but couldn't add them. The file is in the day folder; import it in Q-Bank.", TITLE)
        return
    n, extra = report.get("imported", 0), []
    if report.get("already_in_bank"):
        extra.append(f"{report['already_in_bank']} already in your bank")
    if report.get("conflicts"):
        extra.append(f"{len(report['conflicts'])} clashed (import the file in the app to resolve)")
    notify(f"Added {n} question{'' if n == 1 else 's'} for “{title}”{' (' + '; '.join(extra) + ')' if extra else ''}. They'll show up in Q-Bank after it syncs.", TITLE)


def main(folders):
    for folder in folders:
        try:
            course, root, week, day, lecture = locate(folder)
            # A day folder: every lecture folder in it, one at a time.
            targets = [folder] if lecture else [os.path.join(folder, n) for n in sorted(os.listdir(folder)) if os.path.isdir(os.path.join(folder, n))]
            for t in targets:
                make(t)
        except Exception as e:  # noqa: BLE001 - tell the user rather than fail silently
            qlog(f"error for {folder}: {e!r}")
            notify(f"Couldn't make questions: {e}", TITLE)


if __name__ == "__main__":
    main(sys.argv[1:])
