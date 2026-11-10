"""
Organize lecture files you drop into a course folder (e.g. Block 2) into
Week N/<n Day>/<Lecture>/, using the Canvas schedule (schedule.json, from
parse_schedule.py) to tell which lecture a file belongs to.

  - dropped in the course folder itself → matched against the whole schedule
  - dropped in a Week N folder          → matched against that week's lectures
  - dropped in a day folder             → matched against that day's lectures
  - anything already in a lecture folder, and quiz/day files kept at the day level, is left alone

Downloads is never touched. A LaunchAgent opens qbank-slides://organize when one of
those folders changes. Files it can't place stay where you put them, with a notification.
"""
import datetime, filecmp, os, re, shutil, time
from common import DAYS, HOME, load, log, notify, numbers, overlap, save, words

EXTS = (".pptx", ".ppt", ".key", ".pdf", ".docx", ".doc")
PARTIAL = (".crdownload", ".download", ".part", ".partial", ".tmp", ".opdownload")
DAY_FILE = re.compile(r"^([A-Z]+)(\d+)_W(\d+)_D([1-5])_\d{4}-\d{2}-\d{2}.*\.json$")
SETTLE = 3  # seconds a file must sit unchanged before it's considered downloaded


def course_code(course):
    """ "Block 2" → "B2", as in Q-Bank ids. """
    m = re.match(r"\s*([A-Za-z])[A-Za-z]*\s*(\d+)", course)
    return f"{m.group(1).upper()}{m.group(2)}" if m else course


def stated_week(name):
    """The week a file name says it's for: "TBL Week 15 GI", "B3W14", "W15_notes"."""
    m = re.search(r"(?<![A-Za-z0-9])(?:week[\s_-]*|(?:B\d+)?W)(\d{1,2})(?!\d)", name, re.I)
    return int(m.group(1)) if m else None


def lab_codes(name):
    """Numbers like the 3.5 in "Lab 3.5" (not dates like 10.29.23)."""
    return set(re.findall(r"(?<![\d.])\d+\.\d+(?![\d.])", re.sub(r"\.[A-Za-z]+$", "", name)))


def lecture_dir(day_dir, item, day_items=()):
    """Reuse the day's existing folder for this lecture (e.g. "Gram Negative 1 and 2"), else name it after the calendar."""
    if os.path.isdir(os.path.join(day_dir, item["folder"])):
        return os.path.join(day_dir, item["folder"])
    want, parts = words(item["title"]), numbers(item["title"])
    others = [i for i in day_items if i["folder"] != item["folder"]]
    best, score = None, 0
    if os.path.isdir(day_dir):
        for name in sorted(os.listdir(day_dir)):
            if os.path.isdir(os.path.join(day_dir, name)):
                s = overlap(want, words(name))
                # "Gram Negative 1" can reuse "Gram Negative 1 and 2", but not "Antibacterial Drugs 2".
                if parts and numbers(name) and not parts & numbers(name):
                    continue
                # A folder that belongs to another lecture that day isn't this one's, however many words they share:
                # "Renal Ion Transport" doesn't go in "Renal Clearance and Solute Transport".
                mine = overlap(words(name), want)
                if any(i["folder"] == name or overlap(words(name), words(i["title"])) > mine for i in others):
                    continue
                if s > score:
                    best, score = name, s
    return os.path.join(day_dir, best or item["folder"])


def place(name, schedule, roots, now, course=None, week=None, day=None):
    """Where a file goes (limited to a course, week or day if given), or None if no lecture clearly matches."""
    m = DAY_FILE.match(name)
    if m:
        for c, root in roots.items():
            if course_code(c) == f"{m.group(1)}{m.group(2)}" and course in (None, c):
                return os.path.join(root, f"Week {int(m.group(3))}", DAYS[int(m.group(4)) - 1]), f"{c} day file"
        return None
    if not name.lower().endswith(EXTS):
        return None
    want = words(os.path.splitext(name)[0])
    if not want:
        return None
    # A week in the file name beats guessing from today's date; the folder it was dropped in beats both.
    said = stated_week(name)
    if week is None and any(str(said) in w for c, w in schedule.items() if c in roots and course in (None, c)):
        week = said
    ranked = []
    for c, weeks in schedule.items():
        if c not in roots or course not in (None, c):
            continue
        for w, wk in weeks.items():
            if week is not None and int(w) != week:
                continue
            monday = datetime.date.fromisoformat(wk["monday"])
            for d, items in wk["days"].items():
                if day is not None and int(d) != day:
                    continue
                date = monday + datetime.timedelta(days=int(d) - 1)
                # Prefer lectures near today: a file is usually downloaded the week of its lecture.
                away = (date - now).days
                nearness = abs(away) if away >= -2 else abs(away) * 1.5
                for item in items:
                    score = overlap(want, words(item["title"]))
                    if score:
                        # "Lab 3.5" is that lab and no other.
                        have, mine = lab_codes(item["title"]), lab_codes(name)
                        if have and mine:
                            if not have & mine:
                                continue
                            score += 1
                        # "Antibiotics II" belongs with "Antibacterial Drugs 2", not 1.
                        have, mine = numbers(item["title"]), numbers(name)
                        if have and mine:
                            score += 0.5 if have & mine else -1
                        # On a tie, a lecture within a week of now, then the title the file name covers best:
                        # "Pharmacokinetics" over "Pharmacokinetics Problem Session".
                        covered = overlap(words(item["title"]), want) / max(len(words(item["title"])), 1)
                        ranked.append((score, -nearness, c, int(w), int(d), item, covered))
    if not ranked:
        return None
    ranked.sort(key=lambda r: (r[0], r[1] >= -7, r[6], r[1]), reverse=True)
    top = ranked[0]
    dir_of = lambda r: lecture_dir(os.path.join(roots[r[2]], f"Week {r[3]}", DAYS[r[4] - 1]), r[5], schedule[r[2]][str(r[3])]["days"][str(r[4])])
    # Two different lectures equally good: don't guess, unless they share a folder ("Gram Negative 1 and 2").
    # Across weeks the date or a closer title can settle it; within one week neither says enough ("TBL Week 14 GI" isn't "GI Development").
    rivals = [
        r for r in ranked[1:]
        if r[0] == top[0] and r[5]["folder"] != top[5]["folder"] and (r[3] == top[3] or (r[6] == top[6] and top[1] < -7))
    ]
    if any(dir_of(r) != dir_of(top) for r in rivals):
        log(f"ambiguous: {name} → {top[5]['title']} / {rivals[0][5]['title']}")
        return None
    score, _, c, w, d, item, _ = top
    # Need one solid word match, not just a shared stem.
    solid = [x for x in want if overlap({x}, words(item["title"])) >= 1]
    if score < 1 or not solid:
        return None
    # One matching word is enough for a short title ("Teratology"); for a longer one it must be long and specific,
    # so "Random notes" doesn't land in "Random Control Trials".
    if score < 2 and len(words(item["title"])) > 2 and not any(len(x) >= 8 for x in solid):
        return None
    dest = dir_of(top)
    return dest, f"Week {w} › {DAYS[d - 1]} › {os.path.basename(dest)}"


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


def loose_files(root):
    """(path, week, day) for files sitting loose in the course folder, a Week folder, or a day folder."""
    out = []
    def files_in(d):
        try:
            return [n for n in os.listdir(d) if not n.startswith((".", "~$")) and os.path.isfile(os.path.join(d, n))]
        except OSError:
            return []
    out += [(os.path.join(root, n), None, None) for n in files_in(root)]
    for wname in os.listdir(root):
        m = re.match(r"Week (\d+)$", wname)
        if not m or not os.path.isdir(os.path.join(root, wname)):
            continue
        wdir = os.path.join(root, wname)
        out += [(os.path.join(wdir, n), int(m.group(1)), None) for n in files_in(wdir)]
        for i, dname in enumerate(DAYS, 1):
            # Quiz pages and Q-Bank day files belong at the day level; only lecture files get sorted from there.
            out += [(os.path.join(wdir, dname, n), int(m.group(1)), i) for n in files_in(os.path.join(wdir, dname)) if n.lower().endswith(EXTS)]
    return out


def watch_paths(roots):
    """Folders the LaunchAgent should watch: each course folder, its Week folders, and their day folders."""
    paths = []
    for root in roots.values():
        paths.append(root)
        for wname in sorted(os.listdir(root)):
            if re.match(r"Week \d+$", wname) and os.path.isdir(os.path.join(root, wname)):
                paths.append(os.path.join(root, wname))
                paths += [os.path.join(root, wname, d) for d in DAYS if os.path.isdir(os.path.join(root, wname, d))]
    return paths


def run():
    config = load("config.json", {})
    roots = {c: r for c, r in config.get("courses", {}).items() if os.path.isdir(r)}
    schedule = load("schedule.json", {})
    told = load("organize-state.json", {}).get("told", {})  # files already reported as unplaceable
    today = datetime.date.today()
    for _ in range(20):  # wait up to ~40 s for copies still finishing
        waiting = False
        for course, root in roots.items():
            for path, week, day in loose_files(root):
                name = os.path.basename(path)
                if name.lower().endswith(PARTIAL) or not settled(path):
                    waiting = True
                    continue
                target = place(name, schedule, roots, today, course, week, day)
                if not target:
                    stamp = os.path.getmtime(path)
                    if told.get(path) != stamp and name.lower().endswith(EXTS):
                        told[path] = stamp
                        log(f"organize: no lecture match for {path}")
                        notify(f"Couldn't tell which lecture “{name}” is for, so it's still in {os.path.basename(os.path.dirname(path))}.")
                    continue
                dest_dir, label = target
                if os.path.normpath(dest_dir) == os.path.normpath(os.path.dirname(path)):
                    continue  # a day file already in its day folder
                dest, dup = move(path, dest_dir)
                told.pop(path, None)
                log(f"organize: {path} → {dest}{' (duplicate, trashed)' if dup else ''}")
                notify(f"{'Already had' if dup else 'Filed'} “{name}” → {label}")
        save("organize-state.json", {"told": {p: m for p, m in told.items() if os.path.exists(p)}})
        if not waiting:
            break
        time.sleep(2)
