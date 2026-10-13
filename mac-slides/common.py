"""Shared bits for the Q-Bank Mac helpers: settings, logging, notifications, title matching."""
import datetime, json, os, re, subprocess, unicodedata

HOME = os.path.expanduser("~/Library/Application Support/Q-Bank Slides")
LOG = os.path.expanduser("~/Library/Logs/Q-Bank Slides.log")
DAYS = ["1 Monday", "2 Tuesday", "3 Wednesday", "4 Thursday", "5 Friday"]
DECKS = (".pptx", ".ppt", ".key")
# Words that say nothing about which lecture a file or folder is.
STOP = {
    "the", "and", "of", "for", "to", "in", "a", "an", "with", "on", "vs", "from",
    "intro", "introduction", "lecture", "lectures", "week", "block", "reading", "handout", "independent", "learning", "online",
    "long", "theme", "dctr", "dctr1", "oasa", "fdts", "slides", "final", "foundations", "resource", "resources", "key", "points",
    "video", "pdf", "accessible", "canvas", "students", "prework", "combined", "revised", "assessment", "questions", "practice",
    "poll", "everywhere", "version", "copy", "2023", "2024", "2025", "2026", "2027", "all",
}


def log(msg):
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "a") as f:
        f.write(f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")


def notify(msg, title="Q-Bank Slides"):
    subprocess.run(["osascript", "-e", f"display notification {json.dumps(msg)} with title {json.dumps(title)}"])


def load(name, fallback):
    try:
        with open(os.path.join(HOME, name)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return fallback


def save(name, value):
    os.makedirs(HOME, exist_ok=True)
    tmp = os.path.join(HOME, name + ".tmp")
    with open(tmp, "w") as f:
        json.dump(value, f, indent=1)
    os.replace(tmp, os.path.join(HOME, name))


# Different words course files and the calendar use for the same thing.
SAME = {
    "virus": "virus", "viruses": "virus", "viral": "virus", "virology": "virus",
    "antibiotic": "antibacterial", "antibiotics": "antibacterial", "antimicrobial": "antibacterial", "antimicrobials": "antibacterial",
    "bacteria": "bacteria", "bacterial": "bacteria", "bacteriology": "bacteria",
    "fungi": "fungi", "fungal": "fungi", "fungus": "fungi", "mycology": "fungi",
    "parasite": "parasite", "parasites": "parasite", "parasitic": "parasite", "parasitology": "parasite",
    "antiparasite": "antiparasite", "antiparasites": "antiparasite", "antiparasitic": "antiparasite", "antiparasitics": "antiparasite",
    "teratogen": "teratology", "teratogens": "teratology", "teratology": "teratology",
    "musculoskeletal": "musculoskeletal", "msk": "musculoskeletal",
    "olfaction": "olfactory", "olfactory": "olfactory", "gustation": "gustatory", "gustatory": "gustatory",
    "auditory": "auditory", "hearing": "auditory", "vestibular": "vestibular", "vision": "visual", "visual": "visual",
    "immunodeficiences": "immunodeficiency", "immunodeficiencies": "immunodeficiency", "immunodeficiency": "immunodeficiency",
    "vaccine": "vaccination", "vaccines": "vaccination", "vaccinations": "vaccination", "vaccination": "vaccination",
    "autoimmune": "autoimmune", "autoimmunity": "autoimmune",
}
ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4}


def tokens(s):
    """Lowercase tokens, splitting run-together words ("PrinciplesAntiviral") and keeping hyphenated ones joined too."""
    s = unicodedata.normalize("NFKD", s).replace("~", " ").replace("_", " ")
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s)
    out = re.findall(r"[a-z0-9]+", s.lower())
    out += ["".join(m) for m in re.findall(r"([a-z]+)-([a-z]+)", s.lower())]
    return out


def words(s):
    out = set()
    for w in tokens(s):
        w = SAME.get(w, w)
        if len(w) > 2 and w not in STOP and not w.isdigit():
            out.add(w)
    return out


def numbers(s):
    """Part numbers in a name: "Gram Negative 2", "Antibiotics II" (not "Week 8", "Lab 2.8", "8. Anatomy", versions or dates)."""
    s = re.sub(r"\.(pptx?|key|pdf|docx?|json)$", "", s, flags=re.I)
    s = re.sub(r"\bweek\s*\d+", " ", s, flags=re.I)
    s = re.sub(r"\d+\.\d+|\b\d+\.(?=\s)|\bv\d+", " ", s)
    return {int(w) if w.isdigit() else ROMAN[w] for w in tokens(s) if (w.isdigit() and len(w) == 1) or w in ROMAN}


def similar(w, h):
    if w == h:
        return 1.0
    n = len(os.path.commonprefix([w, h]))
    # A long shared start ("immunodeficienc…") or one word starting the other ("organism"/"organisms") counts fully.
    if n >= 9 or (n >= 5 and n == min(len(w), len(h))):
        return 1.0
    return 0.5 if n >= 5 else 0.0


def overlap(want, have):
    """How well the words `want` are covered by `have` (1 per matching word, ½ for a shared stem)."""
    return sum(max((similar(w, h) for h in have), default=0.0) for w in want)
