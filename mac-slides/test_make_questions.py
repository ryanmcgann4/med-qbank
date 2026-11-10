"""Run with: /usr/bin/python3 -m unittest discover mac-slides"""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_questions import lecture_id_for, same_lecture  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
