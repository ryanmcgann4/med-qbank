#!/usr/bin/python3
"""
Q-Bank Slides: opens the lecture file a question came from, at its slide.

The Q-Bank app links to  qbank-slides://open?course=…&lecture=…&title=…&week=…&date=…&src=…
where `src` is the question's source text ("12", "handout p1", "video slide 5").

Which file a lecture uses comes from lectures.json next to config.json:
  { "<lecture_id>": "Week 7/1 Monday/Bacteriology/Bacteriology.pptx" }
or, when a lecture has several files and the source text says which one:
  { "<lecture_id>": { "default": "…/slides.pdf", "handout": "…/handout.pdf", "key points": "…/key.pdf" } }
Lectures missing from it are found by title inside Week <n>/<day> of the course folder.
"""
import json, os, re, subprocess, sys, unicodedata
from urllib.parse import parse_qs, quote, urlparse

HOME = os.path.expanduser("~/Library/Application Support/Q-Bank Slides")
LOG = os.path.expanduser("~/Library/Logs/Q-Bank Slides.log")
DAYS = ["1 Monday", "2 Tuesday", "3 Wednesday", "4 Thursday", "5 Friday"]
DECKS = (".pptx", ".ppt", ".key")
STOP = {"the", "and", "of", "for", "to", "in", "a", "an", "with", "intro", "introduction", "lecture", "week", "reading", "handout"}


def log(msg):
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "a") as f:
        f.write(msg + "\n")


def notify(msg):
    subprocess.run(["osascript", "-e", f"display notification {json.dumps(msg)} with title \"Q-Bank Slides\""])


def load(name, fallback):
    try:
        with open(os.path.join(HOME, name)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return fallback


def words(s):
    s = unicodedata.normalize("NFKD", s).lower()
    return {w for w in re.findall(r"[a-z0-9]+", s) if len(w) > 2 and w not in STOP}


def overlap(want, have):
    """Title words found in a path; "teratogens" matches "teratology" (same first 5 letters)."""
    return sum(1 for w in want if any(w == h or (len(w) >= 5 and len(h) >= 5 and w[:5] == h[:5]) for h in have))


def pick(entry, src):
    """A lecture's file for this source text, plus the text left after the word that chose it."""
    if isinstance(entry, str):
        return entry, src
    low = src.lower()
    for key, path in entry.items():
        if key != "default" and key in low:
            return path, low.split(key, 1)[1]
    return entry.get("default") or next(iter(entry.values())), src


def weekday_folder(date):
    try:
        import datetime
        d = datetime.date.fromisoformat(date).weekday()
        return DAYS[d] if d < 5 else None
    except ValueError:
        return None


def find_by_title(root, week, date, title, src):
    """No mapping: look in Week <n>/<day> (then the whole week) for the folder or file that best matches the title."""
    week_dir = os.path.join(root, f"Week {week}")
    day = weekday_folder(date)
    places = [os.path.join(week_dir, day)] if day else []
    places.append(week_dir)
    want = words(title)
    best, best_score = None, 0
    for place in places:
        for d, _, files in os.walk(place):
            for f in files:
                if f.startswith((".", "~$")) or not f.lower().endswith(DECKS + (".pdf",)):
                    continue
                path = os.path.join(d, f)
                score = overlap(want, words(os.path.relpath(path, place)))
                if score == 0:
                    continue
                score += 0.5 if f.lower().endswith(DECKS) or "slides" in f.lower() else 0
                if "handout" in src.lower() and "handout" in f.lower():
                    score += 2
                if score > best_score:
                    best, best_score = path, score
        if best:
            return best, (os.path.join(week_dir, day) if day else week_dir)
    return None, (os.path.join(week_dir, day) if day and os.path.isdir(os.path.join(week_dir, day)) else week_dir)


def open_pptx(path, slide):
    script = f'''
    tell application "Microsoft PowerPoint"
        activate
        open POSIX file {json.dumps(path)}
        delay 0.5
        try
            go to slide (view of document window 1) number {slide}
        end try
    end tell'''
    subprocess.run(["osascript", "-e", script], check=True)


def open_pdf(path, page):
    # Edge's (and Chrome's) PDF viewer honors #page=N; Preview has no way to jump to a page from a script.
    url = "file://" + quote(path) + f"#page={page}"
    for browser in ("Microsoft Edge", "Google Chrome"):
        if os.path.isdir(f"/Applications/{browser}.app"):
            script = f'''
            tell application "{browser}"
                activate
                open location {json.dumps(url)}
                delay 0.3
                tell front window to set active tab index to (count tabs)
            end tell'''
            subprocess.run(["osascript", "-e", script], check=True)
            return
    subprocess.run(["open", path], check=True)


def main(url):
    q = {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}
    config = load("config.json", {})
    lectures = load("lectures.json", {})
    root = config.get("courses", {}).get(q.get("course", ""))
    if not root or not os.path.isdir(root):
        notify(f"No slides folder set up for {q.get('course', 'this course')}.")
        return
    src = q.get("src", "")
    path, rest = None, src
    if q.get("lecture") in lectures:
        rel, rest = pick(lectures[q["lecture"]], src)
        path = os.path.join(root, rel)
        if not os.path.isfile(path):
            log(f"mapped file missing: {path}")
            path = None
    if not path:
        path, folder = find_by_title(root, q.get("week", ""), q.get("date", ""), q.get("title", ""), src)
        if not path:
            subprocess.run(["open", folder if os.path.isdir(folder) else root])
            notify(f"Couldn't find the slides for “{q.get('title', '')}”, so here's the folder.")
            return
    m = re.search(r"\d+", rest) or re.search(r"\d+", src)
    slide = int(m.group()) if m else 1
    log(f"{q.get('lecture')} src={src!r} -> {path} @ {slide}")
    if path.lower().endswith(DECKS):
        open_pptx(path, slide)
    elif path.lower().endswith(".pdf"):
        open_pdf(path, slide)
    else:
        subprocess.run(["open", path])


if __name__ == "__main__":
    try:
        main(sys.argv[1] if len(sys.argv) > 1 else "")
    except Exception as e:  # noqa: BLE001 - report anything to the user
        log(f"error: {e!r}")
        notify(f"Couldn't open the slides: {e}")
