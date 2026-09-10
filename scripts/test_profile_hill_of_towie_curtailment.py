import unittest

from scripts.profile_hill_of_towie_curtailment import (
    finalize_field_stats,
    new_field_stats,
    numeric,
    update_field_stats,
)


class HillOfTowieCurtailmentProfileTest(unittest.TestCase):
    def test_numeric_rejects_blank_and_non_finite_values(self):
        self.assertIsNone(numeric(""))
        self.assertIsNone(numeric("nan"))
        self.assertEqual(numeric("1.25"), 1.25)

    def test_field_stats_preserve_zero_nonzero_and_value_counts(self):
        stats = new_field_stats(track_values=True)
        update_field_stats(stats, "0")
        update_field_stats(stats, "1")
        update_field_stats(stats, "")
        finalized = finalize_field_stats(stats)
        self.assertEqual(finalized["rows"], 3)
        self.assertEqual(finalized["nonEmptyRows"], 2)
        self.assertEqual(finalized["numericRows"], 2)
        self.assertEqual(finalized["nonZeroRows"], 1)
        self.assertEqual(finalized["valueCounts"], {"0": 1, "1": 1})
        self.assertEqual(finalized["minimum"], 0.0)
        self.assertEqual(finalized["maximum"], 1.0)


if __name__ == "__main__":
    unittest.main()
