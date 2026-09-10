import unittest
from datetime import datetime, timedelta, timezone

from scripts.build_hill_of_towie_training_pairs import clean_window_profile, hourly_observation_quality_audit


class HillOfTowiePairBuildTest(unittest.TestCase):
    def test_audit_counts_complete_hours_with_invalid_generation_labels(self):
        rows = [
            ("source", datetime(2025, 1, 1, 0, minute, tzinfo=timezone.utc), 1.0)
            for minute in (10, 20, 30, 40, 50)
        ]
        rows.append(("source", datetime(2025, 1, 1, 1, 0, tzinfo=timezone.utc), -0.1))
        self.assertEqual(hourly_observation_quality_audit(rows), (1, 1))

    def test_clean_window_profile_reports_rolling_coverage_without_filling_gaps(self):
        start = datetime(2025, 1, 1, tzinfo=timezone.utc)
        timestamps = [start + timedelta(hours=index) for index in range(90 * 24) if index != 10]
        profile = clean_window_profile(timestamps)
        self.assertEqual(profile["contiguousRunCount"], 2)
        self.assertEqual(profile["best90DayWindow"]["validHours"], 90 * 24 - 1)
        self.assertAlmostEqual(profile["best90DayCompleteness"], 0.9995)
        self.assertTrue(profile["eligible"])


if __name__ == "__main__":
    unittest.main()
