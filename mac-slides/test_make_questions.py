"""Run with: /usr/bin/python3 -m unittest discover mac-slides"""
import json, os, subprocess, sys, tempfile, unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_questions  # noqa: E402
from make_questions import (  # noqa: E402
    assign_ids, build_prompt, default_folder_for, lecture_id_for, next_lecture_id, renumber, reservations, reserved_ids, same_lecture, taken_by_another,
)


def ctx(*titles, others=()):
    lectures = [{"lecture_id": f"B3-W15-D1-L{i}", "title": t} for i, t in enumerate(titles, 1)]
    return {"lectures": lectures, "all_lecture_ids": [l["lecture_id"] for l in lectures] + list(others)}


class SameLecture(unittest.TestCase):
    def test_same_title_matches(self):
        t = "Week 15 - Independent Learning: Cell Injury"
        self.assertTrue(same_lecture(t, t))

    def test_punctuation_differences_match(self):
        self.assertTrue(same_lecture(
            "Week 15 - Flipped Classroom: Kidney Physiology: Concentration-Dilution of Urine",
            "Week 15 - Flipped Classroom: Kidney Physiology: Concentration/Dilution of Urine",
        ))

    def test_sharing_one_word_is_not_enough(self):
        self.assertFalse(same_lecture("Week 15 - Independent Learning: Cell Injury", "Week 15 - Independent Learning: Cell Adaptations"))

    def test_sharing_a_series_name_is_not_enough(self):
        self.assertFalse(same_lecture(
            "Week 15 - Flipped Classroom: Kidney Physiology: Renal Ion Transport",
            "Week 15 - Flipped Classroom: Kidney Physiology: Glomerular Filtration and Renal Plasma Flow",
        ))

    def test_part_numbers_must_agree(self):
        self.assertFalse(same_lecture("Case Studies in Immunology 1", "Case Studies in Immunology 2"))
        self.assertFalse(same_lecture("Case Studies in Immunology", "Case Studies in Immunology 2"))


class LectureIdFor(unittest.TestCase):
    def test_new_lecture_gets_next_number(self):
        c = ctx("Week 15 - Independent Learning: Cell Adaptations", "Week 15 - Flipped Classroom: Kidney Physiology: Glomerular Filtration and Renal Plasma Flow")
        self.assertEqual(lecture_id_for("B3", 15, 1, "Week 15 - Independent Learning: Cell Injury", c), ("B3-W15-D1-L3", False))
        self.assertEqual(lecture_id_for("B3", 15, 1, "Week 15 - Flipped Classroom: Kidney Physiology: Renal Ion Transport", c), ("B3-W15-D1-L3", False))

    def test_rerun_reuses_id(self):
        c = ctx("Week 15 - Independent Learning: Cell Adaptations", "Week 15 - Independent Learning: Cell Injury")
        self.assertEqual(lecture_id_for("B3", 15, 1, "Week 15 - Independent Learning: Cell Injury", c), ("B3-W15-D1-L2", True))

    def test_number_skips_ids_used_elsewhere(self):
        c = ctx("Week 15 - Independent Learning: Cell Adaptations", others=["B3-W15-D1-L4"])
        self.assertEqual(lecture_id_for("B3", 15, 1, "Week 15 - Independent Learning: Cell Injury", c), ("B3-W15-D1-L5", False))


def prompt(**opts):
    count = opts.pop("count", 0)
    existing = opts.pop("existing", False)
    return build_prompt(
        course="Block 3", code="B3", week=15, day=3, date="2026-11-11", day_label="Week 15 – Day 3 (Wed Nov 11)", title="Cell Death",
        lecture_id="B3-W15-D3-L3", existing=existing, inputs=["Cell Death (slides).pdf"], out_name="out.json", opts=opts, count=count,
    )


class BuildPrompt(unittest.TestCase):
    def test_defaults_add_nothing_extra(self):
        p = prompt(difficulty="exam", style="vignettes", yield_focus="balanced", practice=True, notes="")
        self.assertNotIn("Write exactly", p)
        self.assertNotIn("high-yield material", p)
        self.assertNotIn("Extra instructions", p)
        self.assertIn('lecture_id "B3-W15-D3-L3"', p)

    def test_count_and_options(self):
        p = prompt(count=12, difficulty="harder", style="concepts", yield_focus="high", practice=False, notes="Focus on caspases")
        self.assertIn("Write exactly 12 questions", p)
        self.assertIn("mostly difficulty 3–5", p)
        self.assertIn("mostly mechanism questions", p)
        self.assertIn('rate every question "high"', p)
        self.assertIn("Skip the practice questions", p)
        self.assertIn("Extra instructions from me: Focus on caspases", p)

    def test_adding_to_an_existing_lecture(self):
        p = prompt(count=1, existing=True)
        self.assertIn("Write exactly 1 new question for", p)
        self.assertIn("don't repeat any of its questions", p)


class Filing(unittest.TestCase):
    plan = {
        "bank_lectures": [{"lecture_id": "B3-W15-D3-L1", "folder_id": "f-mine"}, {"lecture_id": "B3-W15-D3-L2", "folder_id": None}],
        "day_folder": {"id": "auto-day"},
    }

    def test_existing_lecture_stays_where_it_is(self):
        self.assertEqual(default_folder_for(self.plan, "B3-W15-D3-L1"), "f-mine")
        self.assertEqual(default_folder_for(self.plan, "B3-W15-D3-L2"), "top")

    def test_new_lecture_goes_to_the_day(self):
        self.assertEqual(default_folder_for(self.plan, "new"), "auto-day")

    def test_new_ids_dont_collide(self):
        used = ["B3-W15-D3-L1", "B3-W15-D3-L3", "B3-W15-D1-L9"]
        a = next_lecture_id("B3", 15, 3, used)
        self.assertEqual(a, "B3-W15-D3-L4")
        self.assertEqual(next_lecture_id("B3", 15, 3, used + [a]), "B3-W15-D3-L5")


class OverlappingRuns(unittest.TestCase):
    """Two runs for the same day started a minute apart both numbered their new lecture L2 (B3 W16 D1)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        patches = [mock.patch.object(make_questions, "WORK", self.tmp.name), mock.patch.object(make_questions, "RESERVED", os.path.join(self.tmp.name, "lecture-ids.json"))]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)

    bank = ["B3-W16-D1-L1"]

    def test_second_run_skips_the_first_runs_ids(self):
        # The first run is another live process holding L2 until it imports.
        other = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        self.addCleanup(other.kill)
        with reservations() as held:
            held[str(other.pid)] = ["B3-W16-D1-L2"]
        with reservations() as held:
            ids = assign_ids("B3", 16, 1, [{"key": "gp", "target": "new"}], [], self.bank + reserved_ids(held))
        self.assertEqual(ids, {"gp": ("B3-W16-D1-L3", False)})

    def test_finished_runs_release_their_ids(self):
        dead = subprocess.Popen([sys.executable, "-c", "pass"])
        dead.wait()
        with reservations() as held:
            held[str(dead.pid)] = ["B3-W16-D1-L2"]
        with reservations() as held:
            self.assertEqual(reserved_ids(held), [])

    def test_adding_to_a_bank_lecture_keeps_its_id(self):
        ids = assign_ids("B3", 16, 1, [{"key": "a", "target": "B3-W16-D1-L1"}, {"key": "b", "target": "new"}], [{"lecture_id": "B3-W16-D1-L1"}], self.bank)
        self.assertEqual(ids, {"a": ("B3-W16-D1-L1", True), "b": ("B3-W16-D1-L2", False)})


class RecheckBeforeImport(unittest.TestCase):
    ctx = {"all_lecture_ids": ["B3-W16-D1-L1", "B3-W16-D1-L2"], "lectures": [
        {"lecture_id": "B3-W16-D1-L1", "title": "Asthma"},
        {"lecture_id": "B3-W16-D1-L2", "title": "Week 16 - General Principles of Pharmacology"},
    ]}

    def test_taken_by_a_different_lecture(self):
        self.assertTrue(taken_by_another(self.ctx, "B3-W16-D1-L2", "Week 16 - Drug Absorption and Distribution"))

    def test_free_or_same_lecture_is_fine(self):
        self.assertFalse(taken_by_another(self.ctx, "B3-W16-D1-L3", "Week 16 - Drug Absorption and Distribution"))
        self.assertFalse(taken_by_another(self.ctx, "B3-W16-D1-L2", "Week 16 - General Principles of Pharmacology"))

    def test_renumber_moves_lecture_and_qids(self):
        data = {"lectures": [{"lecture_id": "B3-W16-D1-L2"}], "questions": [{"qid": "B3-W16-D1-L2-Q007", "lecture_id": "B3-W16-D1-L2"}]}
        out = renumber(json.loads(json.dumps(data)), "B3-W16-D1-L2", "B3-W16-D1-L3")
        self.assertEqual(out["lectures"][0]["lecture_id"], "B3-W16-D1-L3")
        self.assertEqual(out["questions"][0], {"qid": "B3-W16-D1-L3-Q007", "lecture_id": "B3-W16-D1-L3"})


if __name__ == "__main__":
    unittest.main()
