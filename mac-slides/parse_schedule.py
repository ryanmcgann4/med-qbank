#!/usr/bin/python3
"""
Turn a Canvas modules page, copied and pasted as text, into the schedule the Mac
helpers use to file downloads and name lecture folders.

  parse_schedule.py canvas.txt --course "Block 2" --first-week 7 --first-monday 2026-09-14

Writes ~/Library/Application Support/Q-Bank Slides/schedule.json (merging courses).
"""
import argparse, datetime, json, os, re

HOME = os.path.expanduser("~/Library/Application Support/Q-Bank Slides")
DAYS = {"monday": 1, "tuesday": 2, "wednesday": 3, "thursday": 4, "friday": 5}


def clean_title(title):
    """Calendar title → folder name: drop "Week N -", "Independent Learning:", "Online Lecture"; no colons or slashes."""
    t = re.sub(r"^\s*Week\s*\d+\s*-\s*", "", title)
    t = re.sub(r"^(Online Lecture|Lecture)\s*:?\s*", "", t, flags=re.I)
    t = re.sub(r"^Independent Learning\s*[:\-]?\s*", "", t, flags=re.I)
    t = re.sub(r"^(Online Lecture|Lecture)\s*:?\s*", "", t, flags=re.I)
    t = t.replace(":", " -").replace("/", "-")
    return re.sub(r"\s+", " ", re.sub(r"\s*-\s*-\s*", " - ", t)).strip(" -")


def parse(text):
    weeks, week, day = {}, None, None
    for line in text.splitlines():
        line = line.strip().lstrip("*").strip()
        m = re.match(r".*?\bWeek\s+(\d+)\b", line)
        if m and not line.startswith("[") and "-" in line and len(line) < 60:
            week, day = int(m.group(1)), None
            weeks.setdefault(week, {})
            continue
        first = line.split(" ")[0].lower() if line else ""
        if first in DAYS and not line.startswith("["):
            day = DAYS[first]
            continue
        m = re.match(r"\[(.+?)\]\((https?://[^)]+)\)", line)
        if m and week is not None and day is not None:
            items = weeks[week].setdefault(day, [])
            title = m.group(1).strip()
            if all(i["title"] != title for i in items):
                items.append({"title": title, "folder": clean_title(title), "url": m.group(2)})
    return weeks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--course", required=True)
    ap.add_argument("--first-week", type=int, required=True)
    ap.add_argument("--first-monday", required=True, help="YYYY-MM-DD of the first week's Monday")
    a = ap.parse_args()
    weeks = parse(open(a.file, encoding="utf-8").read())
    start = datetime.date.fromisoformat(a.first_monday)
    course = {}
    for w, days in sorted(weeks.items()):
        monday = start + datetime.timedelta(weeks=w - a.first_week)
        course[str(w)] = {"monday": monday.isoformat(), "days": {str(d): items for d, items in sorted(days.items())}}
    path = os.path.join(HOME, "schedule.json")
    os.makedirs(HOME, exist_ok=True)
    data = json.load(open(path)) if os.path.exists(path) else {}
    data[a.course] = course
    json.dump(data, open(path, "w"), indent=1)
    n = sum(len(i) for d in course.values() for i in d["days"].values())
    print(f"{a.course}: {len(course)} weeks, {n} calendar items → {path}")


if __name__ == "__main__":
    main()
