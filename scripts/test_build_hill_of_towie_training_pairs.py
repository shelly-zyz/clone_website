import unittest
from datetime import datetime, timezone

from scripts.build_hill_of_towie_training_pairs import hourly_observation_quality_audit


class HillOfTowiePairBuildTest(unittest.TestCase):
    def test_audit_counts_complete_hours_with_invalid_generation_labels(self):
        rows = [
            ("source", datetime(2025, 1, 1, 0, minute, tzinfo=timezone.utc), 1.0)
            for minute in (10, 20, 30, 40, 50)
        ]
        rows.append(("source", datetime(2025, 1, 1, 1, 0, tzinfo=timezone.utc), -0.1))
        self.assertEqual(hourly_observation_quality_audit(rows), (1, 1))


if __name__ == "__main__":
    unittest.main()
