#!/usr/bin/python3
"""
What the File Lectures window (QBankFiling.swift) asks for. Each command prints the window's whole
picture as JSON: the files still loose in a course, Week or day folder with the lectures they might be
for, every lecture folder you could pick instead, and the last files filed.

  filing.py snapshot
  filing.py file      < {"items": [{"path": …, "dest": …}]}   move each file into the lecture folder you chose
  filing.py undo      < {"id": …}                             put a filed file back where it was
  filing.py relocate  < {"id": …, "dest": …}                  move a filed file to another lecture folder
  filing.py leave     < {"path": …}                           it lives where it is: stop asking about it
  filing.py ask       < {"path": …}                           …and ask again after all

Choosing a lecture by hand is remembered (see organize.recall), so the lecture's other files follow.
"""
import datetime, json, os, re, sys

from common import DAYS, load, log, similar, words
from organize import EXTS, PARTIAL, filing_state, lecture_dir, loose_files, move, place, rank, ranked_dir, recall, remember

SUGGESTIONS = 5


def setup():
    roots = {c: r for c, r in load("config.json", {}).get("courses", {}).items() if os.path.isdir(r)}
    return roots, load("schedule.json", {})


def inside(path, root):
    path, root = os.path.realpath(path), os.path.realpath(root)
    return path == root or path.startswith(root + os.sep)


def spot(dest, roots):
    """(course, week, day, "Week N/<n Day>/<Folder>") for a lecture folder, or None if `dest` isn't one in a course."""
    for course, root in roots.items():
        if not inside(dest, root):
            continue
        parts = os.path.relpath(os.path.realpath(dest), os.path.realpath(root)).split(os.sep)
        if len(parts) != 3:
            return None
        m = re.fullmatch(r"Week (\d{1,3})", parts[0])
        ok_name = parts[2].strip() and not parts[2].startswith(".") and ":" not in parts[2]
        if not m or parts[1] not in DAYS or not ok_name:
            return None
        return course, int(m.group(1)), DAYS.index(parts[1]) + 1, "/".join(parts)
    return None


def label(rel):
    return " › ".join(rel.split("/"))


def destinations(roots, schedule):
    """Every lecture folder you could file into: the calendar's lectures, then folders you made yourself."""
    out, seen = [], set()
    for course, root in roots.items():
        weeks = schedule.get(course, {})
        for w in sorted(weeks, key=int):
            for d in sorted(weeks[w]["days"], key=int):
                items = weeks[w]["days"][d]
                day_dir = os.path.join(root, f"Week {int(w)}", DAYS[int(d) - 1])
                for item in items:
                    dest = lecture_dir(day_dir, item, items)
                    if dest not in seen:
                        seen.add(dest)
                        out.append({"id": dest, "course": course, "week": int(w), "day": int(d), "name": os.path.basename(dest), "title": item["title"]})
        for wname in sorted(os.listdir(root)):
            m = re.fullmatch(r"Week (\d+)", wname)
            if not m:
                continue
            for i, dname in enumerate(DAYS, 1):
                day_dir = os.path.join(root, wname, dname)
                if not os.path.isdir(day_dir):
                    continue
                for name in sorted(os.listdir(day_dir)):
                    dest = os.path.join(day_dir, name)
                    if os.path.isdir(dest) and not name.startswith(".") and dest not in seen:
                        seen.add(dest)
                        out.append({"id": dest, "course": course, "week": int(m.group(1)), "day": i, "name": name, "title": ""})
    out.sort(key=lambda x: (list(roots).index(x["course"]), x["week"], x["day"]))
    return out


def current_week(weeks, today):
    """The week of the calendar we're in (or the nearest one)."""
    best = None
    for w, wk in weeks.items():
        away = abs((datetime.date.fromisoformat(wk["monday"]) + datetime.timedelta(days=2) - today).days)
        if best is None or away < best[0]:
            best = away, int(w)
    return best[1] if best else None


def suggestions(name, roots, schedule, today, course, week, day, learned):
    """(folders this file might belong in, best first; whether the first is sure enough to file without asking)."""
    sure = place(name, schedule, roots, today, course, week, day, learned)
    exact, close = recall(name, learned, roots, today, course, week, day)
    found = [sure[0]] if sure else []
    found += [d for d, _ in ([exact] if exact else []) + close]
    # For the menu only, count abbreviations too ("Chr Inflam Tis Rep" is Chronic Inflammation & Tissue Repair):
    # too loose to file on, but it puts the likelier lecture first.
    want = words(os.path.splitext(name)[0])
    short = lambda r: sum(0.5 for w in want if any(t != w and t.startswith(w) and similar(w, t) == 0 for t in words(r[5]["title"])))
    ranked = rank(name, schedule, roots, today, course, week, day)
    ranked = sorted(ranked[:SUGGESTIONS * 6], key=lambda r: r[0] + short(r), reverse=True)
    found += [ranked_dir(r, schedule, roots) for r in ranked]
    return list(dict.fromkeys(found))[:SUGGESTIONS], bool(sure)


def snapshot(roots=None, schedule=None, today=None):
    if roots is None:
        roots, schedule = setup()
    today = today or datetime.date.today()
    with filing_state() as state:
        learned, held, history = list(state["learned"]), dict(state["held"]), list(state["history"])
    unfiled, left = [], []
    for course, root in roots.items():
        for path, week, day in loose_files(root):
            name = os.path.basename(path)
            if not name.lower().endswith(EXTS) or name.lower().endswith(PARTIAL):
                continue
            where = label(os.path.relpath(os.path.dirname(path), os.path.dirname(root)))
            if held.get(path) == "leave":
                left.append({"path": path, "name": name, "where": where})
                continue
            found, sure = suggestions(name, roots, schedule, today, course, week, day, learned)
            unfiled.append({"path": path, "name": name, "course": course, "where": where, "week": week, "day": day, "candidates": found, "sure": sure})
    recent = [
        {"id": h["id"], "name": os.path.basename(h["dest"]), "dest": h["dest"], "label": h["label"], "when": h["when"], "auto": h["auto"],
         "course": (spot(os.path.dirname(h["dest"]), roots) or [""])[0]}
        for h in reversed(history) if os.path.isfile(h["dest"])
    ]
    return {
        "courses": [{"name": c, "root": r, "currentWeek": current_week(schedule.get(c, {}), today)} for c, r in roots.items()],
        "unfiled": unfiled, "left": left, "recent": recent, "destinations": destinations(roots, schedule),
    }


def learn(state, name, course, week, day, rel, today):
    """Remember that a file with this name belongs in this folder (replacing what was remembered for the name)."""
    want = sorted(words(os.path.splitext(name)[0]))
    if not want:
        return
    state["learned"] = [e for e in state["learned"] if e["words"] != want][-300:]
    state["learned"].append({"words": want, "course": course, "week": week, "day": day, "dir": rel, "when": today.isoformat()})


def tidy(folder):
    """Remove a lecture folder we made that's now empty."""
    try:
        if not [n for n in os.listdir(folder) if n != ".DS_Store"]:
            ds = os.path.join(folder, ".DS_Store")
            if os.path.exists(ds):
                os.remove(ds)
            os.rmdir(folder)
    except OSError:
        pass


def file_items(items, roots, today=None):
    today = today or datetime.date.today()
    problems = []
    with filing_state() as state:
        for it in items:
            path, dest_dir = it.get("path", ""), it.get("dest", "")
            name, at = os.path.basename(path), spot(dest_dir, roots)
            if not os.path.isfile(path) or not any(inside(path, r) for r in roots.values()):
                problems.append(f"“{name}” isn't there any more.")
                continue
            if not at:
                problems.append(f"“{name}”: that isn't a lecture folder inside a course.")
                continue
            course, week, day, rel = at
            made = not os.path.isdir(dest_dir)
            dest, dup = move(path, dest_dir)
            log(f"filing: {path} → {dest}{' (duplicate, trashed)' if dup else ''}")
            if not dup:
                remember(state, path, dest, label(rel), False, made)
            learn(state, name, course, week, day, rel, today)
            state["held"].pop(path, None)
    return problems


def undo(entry_id, roots):
    with filing_state() as state:
        h = next((h for h in state["history"] if h["id"] == entry_id), None)
        if not h or not os.path.isfile(h["dest"]):
            return ["That file isn't where it was filed any more."]
        back = h["src"]
        os.makedirs(os.path.dirname(back), exist_ok=True)
        base, ext = os.path.splitext(back)
        n = 2
        while os.path.exists(back):
            back = f"{base} ({n}){ext}"
            n += 1
        os.rename(h["dest"], back)
        log(f"filing: undo {h['dest']} → {back}")
        # Don't let the organizer put it straight back: it waits in the window for you to choose.
        state["held"][back] = "ask"
        state["history"].remove(h)
        at = spot(os.path.dirname(h["dest"]), roots)
        want = sorted(words(os.path.splitext(h["name"])[0]))
        if at:
            state["learned"] = [e for e in state["learned"] if not (e["words"] == want and e["dir"] == at[3])]
        if h.get("made"):
            tidy(os.path.dirname(h["dest"]))
    return []


def relocate(entry_id, dest_dir, roots, today=None):
    today = today or datetime.date.today()
    with filing_state() as state:
        h = next((h for h in state["history"] if h["id"] == entry_id), None)
        at = spot(dest_dir, roots)
        if not h or not os.path.isfile(h["dest"]):
            return ["That file isn't where it was filed any more."]
        if not at:
            return ["That isn't a lecture folder inside a course."]
        old_dir = os.path.dirname(h["dest"])
        if os.path.realpath(old_dir) == os.path.realpath(dest_dir):
            return []
        course, week, day, rel = at
        made = not os.path.isdir(dest_dir)
        dest, dup = move(h["dest"], dest_dir)
        log(f"filing: moved {h['dest']} → {dest}")
        if h.get("made"):
            tidy(old_dir)
        if dup:
            state["history"].remove(h)
        else:
            h.update(dest=dest, name=os.path.basename(dest), label=label(rel), auto=False, made=made)
        learn(state, os.path.basename(h["src"]), course, week, day, rel, today)
    return []


def hold(path, how, roots):
    with filing_state() as state:
        if os.path.isfile(path) and any(inside(path, r) for r in roots.values()):
            state["held"][path] = how
    return []


def main(argv):
    command = argv[1] if len(argv) > 1 else "snapshot"
    roots, schedule = setup()
    problems = []
    if command != "snapshot":
        ask = json.load(sys.stdin)
        if command == "file":
            problems = file_items(ask.get("items", []), roots)
        elif command == "undo":
            problems = undo(ask.get("id"), roots)
        elif command == "relocate":
            problems = relocate(ask.get("id"), ask.get("dest", ""), roots)
        elif command in ("leave", "ask"):
            problems = hold(ask.get("path", ""), command, roots)
        else:
            problems = [f"Unknown command: {command}"]
    out = snapshot(roots, schedule)
    out["problems"] = problems
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    try:
        main(sys.argv)
    except Exception as e:  # noqa: BLE001 - the window shows it
        log(f"filing error: {e!r}")
        json.dump({"error": f"{e}"}, sys.stdout)
