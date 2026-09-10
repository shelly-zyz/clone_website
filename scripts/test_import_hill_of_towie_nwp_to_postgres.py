import unittest
from datetime import datetime, timezone

from scripts.import_hill_of_towie_nwp_to_postgres import (
    aggregate_hourly_observations,
    build_training_row,
    hour_end,
    interpolate_nwp,
    parse_timestamp,
)


class HillOfTowieNwpImportTest(unittest.TestCase):
    def test_end_of_period_records_are_assigned_to_the_hour_they_complete(self):
        self.assertEqual(hour_end(parse_timestamp("2025-01-01T00:00:00Z")), parse_timestamp("2025-01-01T00:00:00Z"))
        self.assertEqual(hour_end(parse_timestamp("2025-01-01T00:10:00Z")), parse_timestamp("2025-01-01T01:00:00Z"))

    def test_hourly_aggregation_requires_six_regular_ten_minute_rows(self):
        rows = [(datetime(2025, 1, 1, 0, minute, tzinfo=timezone.utc), float(minute)) for minute in (10, 20, 30, 40, 50)]
        rows.append((datetime(2025, 1, 1, 1, 0, tzinfo=timezone.utc), 60.0))
        self.assertEqual(aggregate_hourly_observations(rows)[parse_timestamp("2025-01-01T01:00:00Z")], 35.0)
        self.assertEqual(aggregate_hourly_observations(rows[:-1]), {})

    def test_negative_generation_labels_are_excluded_from_training_hours(self):
        rows = [(datetime(2025, 1, 1, 0, minute, tzinfo=timezone.utc), 1.0) for minute in (10, 20, 30, 40, 50)]
        rows.append((datetime(2025, 1, 1, 1, 0, tzinfo=timezone.utc), -0.1))
        self.assertEqual(aggregate_hourly_observations(rows), {})

    def test_interpolation_uses_only_issue_times_before_the_target(self):
        records = [
            {"issue_time": parse_timestamp("2025-01-01T00:00:00Z"), "valid_time": parse_timestamp("2025-01-01T03:00:00Z"), "u100_mps": 0.0, "v100_mps": 8.0, "wind_speed_mps": 8.0},
            {"issue_time": parse_timestamp("2025-01-01T00:00:00Z"), "valid_time": parse_timestamp("2025-01-01T06:00:00Z"), "u100_mps": 6.0, "v100_mps": 8.0, "wind_speed_mps": 10.0},
        ]
        result = interpolate_nwp(records, parse_timestamp("2025-01-01T04:00:00Z"))
        self.assertEqual(result["method"], "linear-vector-interpolation")
        self.assertEqual(result["issue_time"], parse_timestamp("2025-01-01T00:00:00Z"))
        self.assertAlmostEqual(result["u100_mps"], 2.0)
        self.assertAlmostEqual(result["v100_mps"], 8.0)
        self.assertAlmostEqual(result["wind_speed_mps"], 8.2462112512)

    def test_training_row_keeps_curtailment_unknown(self):
        profile = {
            "entity": {
                "id": "hill-of-towie", "technology": "wind", "timezone": "UTC", "installedCapacityMw": 48.3,
                "centroid": {"latitude": 57.505768, "longitude": -3.068384},
            },
        }
        nwp = {
            "issue_time": parse_timestamp("2025-01-01T00:00:00Z"), "u100_mps": 1.0, "v100_mps": 2.0,
            "wind_speed_mps": 2.236, "method": "native-3-hour", "native_prev_valid_time": parse_timestamp("2025-01-01T03:00:00Z"),
            "native_next_valid_time": parse_timestamp("2025-01-01T03:00:00Z"), "fraction": 0.0,
        }
        row = build_training_row(parse_timestamp("2025-01-01T03:00:00Z"), 12.0, nwp, 46.0, True, profile)
        self.assertFalse(row["curtailment_flag"])
        self.assertFalse(row["curtailment_known"])
        self.assertEqual(row["audit_status"], "research-only")

    def test_training_row_rejects_negative_observed_power(self):
        profile = {
            "entity": {
                "id": "hill-of-towie", "technology": "wind", "timezone": "UTC", "installedCapacityMw": 48.3,
                "centroid": {"latitude": 57.505768, "longitude": -3.068384},
            },
        }
        nwp = {
            "issue_time": parse_timestamp("2025-01-01T00:00:00Z"), "u100_mps": 1.0, "v100_mps": 2.0,
            "wind_speed_mps": 2.236, "method": "native-3-hour", "native_prev_valid_time": parse_timestamp("2025-01-01T03:00:00Z"),
            "native_next_valid_time": parse_timestamp("2025-01-01T03:00:00Z"), "fraction": 0.0,
        }
        with self.assertRaisesRegex(ValueError, "negative observed generation"):
            build_training_row(parse_timestamp("2025-01-01T03:00:00Z"), -0.1, nwp, 46.0, False, profile)


if __name__ == "__main__":
    unittest.main()
