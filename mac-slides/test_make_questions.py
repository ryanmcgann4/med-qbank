"""Run with: /usr/bin/python3 -m unittest discover mac-slides"""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_questions import build_prompt, default_folder_for, lecture_id_for, next_lecture_id, same_lecture  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
