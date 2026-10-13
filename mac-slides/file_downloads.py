"""
File new lecture downloads into <course folder>/Week N/<n Day>/<Lecture>/, using the
Canvas schedule (schedule.json, from parse_schedule.py) to tell which lecture a file
belongs to. Runs whenever ~/Downloads changes (a LaunchAgent opens
qbank-slides://file-downloads). Only files that arrive after it's installed are
touched, and anything it can't place confidently stays in Downloads.
"""
import datetime, filecmp, os, re, shutil, time
from common import DAYS, HOME, load, log, notify, numbers, overlap, save, words

DOWNLOADS = os.path.expanduser("~/Downloads")
EXTS = (".pptx", ".ppt", ".key", ".pdf", ".docx", ".doc")
PARTIAL = (".crdownload", ".download", ".part", ".partial", ".tmp", ".opdownload")
DAY_FILE = re.compile(r"^([A-Z]+)(\d+)_W(\d+)_D([1-5])_\d{4}-\d{2}-\d{2}.*\.json$")
SETTLE = 3  # seconds a file must sit unchanged before it's considered downloaded


def course_code(course):
    """ "Block 2" → "B2", as in Q-Bank ids. """
    m = re.match(r"\s*([A-Za-z])[A-Za-z]*\s*(\d+)", course)
    return f"{m.group(1).upper()}{m.group(2)}" if m else course


def lecture_dir(day_dir, item):
    """Reuse the day's existing folder for this lecture (e.g. "Gram Negative 1 and 2"), else name it after the calendar."""
    if os.path.isdir(os.path.join(day_dir, item["folder"])):
        return os.path.join(day_dir, item["folder"])
    want, parts = words(item["title"]), numbers(item["title"])
    best, score = None, 0
    if os.path.isdir(day_dir):
        for name in sorted(os.listdir(day_dir)):
            if os.path.isdir(os.path.join(day_dir, name)):
                s = overlap(want, words(name))
                # "Gram Negative 1" can reuse "Gram Negative 1 and 2", but not "Antibacterial Drugs 2".
                if parts and numbers(name) and not parts & numbers(name):
                    continue
                if s > score:
                    best, score = name, s
    return os.path.join(day_dir, best or item["folder"])


def place(name, schedule, roots, now):
    """Where a downloaded file goes, or None if no lecture clearly matches."""
    m = DAY_FILE.match(name)
    if m:
        for course, root in roots.items():
            if course_code(course) == f"{m.group(1)}{m.group(2)}":
                return os.path.join(root, f"Week {int(m.group(3))}", DAYS[int(m.group(4)) - 1]), f"{course} day file"
        return None
    if not name.lower().endswith(EXTS):
        return None
    want = words(os.path.splitext(name)[0])
    if not want:
        return None
    ranked = []
    for course, weeks in schedule.items():
        if course not in roots:
            continue
        for w, wk in weeks.items():
            monday = datetime.date.fromisoformat(wk["monday"])
            for d, items in wk["days"].items():
                date = monday + datetime.timedelta(days=int(d) - 1)
                # Prefer lectures near today: a file is usually downloaded the week of its lecture.
                away = (date - now).days
                nearness = abs(away) if away >= -2 else abs(away) * 1.5
                for item in items:
                    score = overlap(want, words(item["title"]))
                    if score:
                        # "Antibiotics II" belongs with "Antibacterial Drugs 2", not 1.
                        have, mine = numbers(item["title"]), numbers(name)
                        if have and mine:
                            score += 0.5 if have & mine else -1
                        ranked.append((score, -nearness, course, int(w), int(d), item))
    if not ranked:
        return None
    ranked.sort(key=lambda r: (r[0], r[1]), reverse=True)
    top = ranked[0]
    dir_of = lambda r: lecture_dir(os.path.join(roots[r[2]], f"Week {r[3]}", DAYS[r[4] - 1]), r[5])
    # Two different lectures equally good and equally near: don't guess, unless they share a folder ("Gram Negative 1 and 2").
    rivals = [r for r in ranked[1:] if r[:2] == top[:2] and r[5]["title"] != top[5]["title"]]
    if any(dir_of(r) != dir_of(top) for r in rivals):
        log(f"ambiguous: {name} → {top[5]['title']} / {rivals[0][5]['title']}")
        return None
    score, _, course, w, d, item = top
    # Need one solid word match (not just a shared stem), and a short word like "cells" alone isn't enough for a long title.
    solid = [x for x in want if overlap({x}, words(item["title"])) >= 1]
    if score < 1 or not solid or (score < 2 and len(words(item["title"])) > 2 and not any(len(x) >= 6 for x in solid)):
        return None
    day_dir = os.path.join(roots[course], f"Week {w}", DAYS[d - 1])
    return lecture_dir(day_dir, item), f"Week {w} › {DAYS[d - 1]} › {os.path.basename(lecture_dir(day_dir, item))}"


def settled(path):
    try:
        return time.time() - os.path.getmtime(path) >= SETTLE and not any(os.path.exists(path + p) for p in PARTIAL)
    except OSError:
        return False


def move(src, dest_dir):
    os.makedirs(dest_dir, exist_ok=True)
    name = os.path.basename(src)
    dest = os.path.join(dest_dir, name)
    if os.path.exists(dest):
        if filecmp.cmp(src, dest, shallow=False):
            trash = os.path.join(os.path.expanduser("~/.Trash"), name)
            n = 2
            while os.path.exists(trash):
                trash = os.path.join(os.path.expanduser("~/.Trash"), f"{os.path.splitext(name)[0]} {n}{os.path.splitext(name)[1]}")
                n += 1
            shutil.move(src, trash)
            return dest, True
        base, ext = os.path.splitext(name)
        n = 2
        while os.path.exists(dest):
            dest = os.path.join(dest_dir, f"{base} ({n}){ext}")
            n += 1
    os.rename(src, dest)
    return dest, False


def run():
    config = load("config.json", {})
    roots = {c: r for c, r in config.get("courses", {}).items() if os.path.isdir(r)}
    schedule = load("schedule.json", {})
    state = load("filed-state.json", None)
    names = lambda: {n: os.path.getmtime(os.path.join(DOWNLOADS, n)) for n in os.listdir(DOWNLOADS) if not n.startswith((".", "~$"))}
    if state is None:
        # First run: everything already in Downloads is left alone.
        save("filed-state.json", {"seen": names()})
        log("file-downloads: started watching Downloads")
        return
    seen = state.get("seen", {})
    today = datetime.date.today()
    for _ in range(20):  # wait up to ~40 s for downloads still finishing
        current = names()
        fresh = [n for n, mtime in current.items() if seen.get(n) != mtime and os.path.isfile(os.path.join(DOWNLOADS, n))]
        waiting = False
        for name in fresh:
            path = os.path.join(DOWNLOADS, name)
            if name.lower().endswith(PARTIAL) or not settled(path):
                waiting = True
                continue
            seen[name] = current[name]
            target = place(name, schedule, roots, today)
            if not target:
                if name.lower().endswith(EXTS):
                    log(f"file-downloads: no lecture match for {name}")
                continue
            dest_dir, label = target
            dest, dup = move(path, dest_dir)
            seen.pop(name, None)
            log(f"file-downloads: {name} → {dest}{' (duplicate, trashed)' if dup else ''}")
            notify(f"{'Already had' if dup else 'Filed'} “{name}” → {label}")
        save("filed-state.json", {"seen": {n: m for n, m in seen.items() if n in current}})
        if not waiting:
            break
        time.sleep(2)
