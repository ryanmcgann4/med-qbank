"""Run with: /usr/bin/python3 -m unittest discover mac-slides"""
import datetime, os, sys, tempfile, unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common, filing, organize  # noqa: E402

TODAY = datetime.date(2026, 11, 16)
SCHEDULE = {"Block 3": {
    "15": {"monday": "2026-11-09", "days": {"4": [
        {"title": "Week 15 - Independent Learning: Acute Inflammation", "folder": "Acute Inflammation"},
        {"title": "Week 15 - Independent Learning: Chronic Inflammation & Tissue Repair", "folder": "Chronic Inflammation & Tissue Repair"},
    ]}},
    "16": {"monday": "2026-11-16", "days": {"1": [
        {"title": "Week 16 - General Principles of Pharmacology", "folder": "General Principles of Pharmacology"},
        {"title": "Week 16 - Drug Absorption and Distribution", "folder": "Drug Absorption and Distribution"},
    ]}},
}}


class Filing(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = os.path.realpath(self.tmp.name)
        self.root = os.path.join(base, "Block 3")
        self.monday = os.path.join(self.root, "Week 16", "1 Monday")
        os.makedirs(self.monday)
        self.roots = {"Block 3": self.root}
        for p in (mock.patch.object(common, "HOME", os.path.join(base, "support")), mock.patch.object(common, "LOG", os.path.join(base, "log")),
                  mock.patch.object(organize, "settled", lambda path: True), mock.patch.object(organize, "notify", lambda *a, **k: None),
                  mock.patch.object(organize, "WINDOW", os.path.join(base, "no-window.app"))):
            p.start()
            self.addCleanup(p.stop)
        common.save("config.json", {"courses": self.roots})
        common.save("schedule.json", SCHEDULE)

    def drop(self, name, folder=None):
        path = os.path.join(folder or self.root, name)
        with open(path, "w") as f:
            f.write(name)
        return path

    def snap(self):
        return filing.snapshot(self.roots, SCHEDULE, TODAY)

    def learned(self):
        with organize.filing_state() as s:
            return list(s["learned"])

    def test_clear_match_is_offered_as_sure(self):
        self.drop("PREREADING_DrugAbsorptionDistribution~AZHDARINIA.docx")
        (row,) = self.snap()["unfiled"]
        self.assertTrue(row["sure"])
        self.assertEqual(row["candidates"][0], os.path.join(self.monday, "Drug Absorption and Distribution"))

    def test_ambiguous_file_lists_both_lectures_unsure(self):
        self.drop("Inflammation session slides.pptx")
        (row,) = self.snap()["unfiled"]
        self.assertFalse(row["sure"])
        self.assertEqual({os.path.basename(c) for c in row["candidates"]}, {"Acute Inflammation", "Chronic Inflammation & Tissue Repair"})

    def test_abbreviations_put_the_likelier_lecture_first(self):
        self.drop("Chr Inflam Tis Rep session slides 2026-27 accessible fixed.pptx")
        (row,) = self.snap()["unfiled"]
        self.assertEqual((row["sure"], os.path.basename(row["candidates"][0])), (False, "Chronic Inflammation & Tissue Repair"))

    def test_unmatched_file_has_no_candidates_and_new_folder_can_be_made(self):
        path = self.drop("TBL Asthma Walder.pptx", self.monday)
        (row,) = self.snap()["unfiled"]
        self.assertEqual((row["candidates"], row["week"], row["day"]), ([], 16, 1))
        dest = os.path.join(self.monday, "Asthma")
        self.assertEqual(filing.file_items([{"path": path, "dest": dest}], self.roots, TODAY), [])
        self.assertTrue(os.path.isfile(os.path.join(dest, "TBL Asthma Walder.pptx")))
        snap = self.snap()
        self.assertEqual(snap["unfiled"], [])
        self.assertEqual(snap["recent"][0]["label"], "Week 16 › 1 Monday › Asthma")
        self.assertIn(dest, [d["id"] for d in snap["destinations"]])

    def test_a_hand_pick_pulls_in_the_lectures_other_files(self):
        dest = os.path.join(self.monday, "Asthma")
        filing.file_items([{"path": self.drop("TBL Asthma Walder.pptx"), "dest": dest}], self.roots, TODAY)
        learned = self.learned()
        place = lambda name, now=TODAY: organize.place(name, SCHEDULE, self.roots, now, "Block 3", None, None, learned)
        self.assertEqual(place("Asthma brick 2.pdf")[0], dest)
        self.assertEqual(place("Brick Exchange • B3W16 - Asthma TBL Prep Brick #1.pdf")[0], dest)
        self.assertEqual(place("TBL Asthma Walder 2026.pptx")[0], dest)  # same name but for a word that says nothing
        self.assertIsNone(place("TBL COPD Walder.pptx"))  # the lecturer's name isn't the topic
        self.assertIsNone(place("B3W17 Asthma review.pdf"))  # says it's another week
        self.assertIsNone(place("Asthma brick 2.pdf", TODAY + datetime.timedelta(days=30)))  # long after
        # The calendar still wins when it knows.
        self.assertEqual(os.path.basename(place("General Principles Pharmacology Asthma.pdf")[0]), "General Principles of Pharmacology")

    def test_a_hand_pick_settles_an_ambiguous_name_next_time(self):
        dest = os.path.join(self.root, "Week 15", "4 Thursday", "Chronic Inflammation & Tissue Repair")
        filing.file_items([{"path": self.drop("Chr Inflam Tis Rep session slides.pptx"), "dest": dest}], self.roots, TODAY)
        self.drop("Chr Inflam Tis Rep session slides.pptx")
        (row,) = self.snap()["unfiled"]
        self.assertEqual((row["sure"], row["candidates"][0]), (True, dest))

    def test_undo_puts_it_back_and_the_organizer_leaves_it(self):
        src = self.drop("Drug Absorption slides.pptx")
        organize.run()
        dest = os.path.join(self.monday, "Drug Absorption and Distribution")
        self.assertTrue(os.path.isfile(os.path.join(dest, "Drug Absorption slides.pptx")))
        (recent,) = self.snap()["recent"]
        self.assertTrue(recent["auto"])
        self.assertEqual(filing.undo(recent["id"], self.roots), [])
        self.assertFalse(os.path.exists(dest))  # the folder it made is gone again
        organize.run()
        self.assertTrue(os.path.isfile(src))
        self.assertEqual([r["path"] for r in self.snap()["unfiled"]], [src])

    def test_moving_a_filed_file_teaches_the_new_place(self):
        self.drop("Drug Absorption slides.pptx")
        organize.run()
        (recent,) = self.snap()["recent"]
        dest = os.path.join(self.monday, "General Principles of Pharmacology")
        self.assertEqual(filing.relocate(recent["id"], dest, self.roots, TODAY), [])
        self.assertTrue(os.path.isfile(os.path.join(dest, "Drug Absorption slides.pptx")))
        self.assertFalse(os.path.exists(os.path.join(self.monday, "Drug Absorption and Distribution")))
        # The same name next time goes where you moved it, not where the calendar says.
        self.assertEqual(organize.place("Drug Absorption slides.pptx", SCHEDULE, self.roots, TODAY, "Block 3", None, None, self.learned())[0], dest)

    def test_leave_hides_a_file_until_asked_again(self):
        path = self.drop("Random notes.pdf", self.monday)
        filing.hold(path, "leave", self.roots)
        snap = self.snap()
        self.assertEqual((snap["unfiled"], [l["path"] for l in snap["left"]]), ([], [path]))
        filing.hold(path, "ask", self.roots)
        self.assertEqual([r["path"] for r in self.snap()["unfiled"]], [path])

    def test_only_lecture_folders_inside_a_course_are_accepted(self):
        path = self.drop("TBL Asthma Walder.pptx")
        for dest in (os.path.dirname(self.root), self.monday, os.path.join(self.monday, "A", "B"), os.path.join(self.root, "Week 16", "..", "..", "x", "y", "z"),
                     os.path.join(self.root, "Week 16", "6 Saturday", "A"), os.path.join(self.monday, ".hidden")):
            self.assertEqual(len(filing.file_items([{"path": path, "dest": dest}], self.roots, TODAY)), 1, dest)
        self.assertTrue(os.path.isfile(path))


if __name__ == "__main__":
    unittest.main()
