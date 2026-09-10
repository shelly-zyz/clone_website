import unittest

import pandas as pd

from scripts.train_sdwpf_lightgbm import ROLLING_SPLITS, build_supervised, split_supervised, summarize_rolling_horizon


class BuildSupervisedTest(unittest.TestCase):
    def setUp(self):
        rows = 180
        self.frame = pd.DataFrame({
            "day": [1 + index // 144 for index in range(rows)],
            "serial_minute": [index * 10 for index in range(rows)],
            "power_mw": [float(index) for index in range(rows)],
            "mean_wind_speed_mps": [6.0 for _ in range(rows)],
            "coverage": [1.0 for _ in range(rows)],
            "usable": [1 for _ in range(rows)],
        })

    def test_target_is_strictly_in_the_future(self):
        result = build_supervised(self.frame, 6)
        first = result.iloc[0]
        self.assertEqual(first["power_now"], 144.0)
        self.assertEqual(first["target"], 150.0)
        self.assertEqual(first["power_lag_144"], 0.0)

    def test_unusable_history_is_excluded(self):
        self.frame.loc[0, "usable"] = 0
        result = build_supervised(self.frame, 1)
        self.assertNotIn(144, result.index)

    def test_rolling_splits_are_ordered_and_non_overlapping(self):
        days = pd.DataFrame({"target_day": list(range(1, 246))})
        for split in ROLLING_SPLITS:
            train, validation, holdout = split_supervised(days, split)
            self.assertLess(train["target_day"].max(), validation["target_day"].min())
            self.assertLess(validation["target_day"].max(), holdout["target_day"].min())
            self.assertEqual(len(holdout), 31)

    def test_rolling_candidate_requires_every_fold_to_beat_persistence(self):
        stable = summarize_rolling_horizon([
            {"maeImprovementPct": 1.0, "beatsPersistence": True},
            {"maeImprovementPct": 2.0, "beatsPersistence": True},
            {"maeImprovementPct": 0.5, "beatsPersistence": True},
        ])
        unstable = summarize_rolling_horizon([
            {"maeImprovementPct": 1.0, "beatsPersistence": True},
            {"maeImprovementPct": -0.1, "beatsPersistence": False},
            {"maeImprovementPct": 0.5, "beatsPersistence": True},
        ])

        self.assertTrue(stable["passesRollingGate"])
        self.assertFalse(unstable["passesRollingGate"])
        self.assertEqual(unstable["wins"], 2)


if __name__ == "__main__":
    unittest.main()
