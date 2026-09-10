import unittest

from scripts.import_hill_of_towie_to_postgres import observation_quality, optional_bool, signal_quality, utc_timestamp


class HillOfTowieImportTest(unittest.TestCase):
    def test_source_boolean_is_not_invented_when_blank(self):
        self.assertIsNone(optional_bool(""))
        self.assertTrue(optional_bool("1"))
        self.assertFalse(optional_bool("0"))

    def test_quality_keeps_missing_and_physical_outliers_out_of_valid_rows(self):
        self.assertEqual(signal_quality(1200, 8.5), "valid")
        self.assertEqual(signal_quality(None, 8.5), "missing")
        self.assertEqual(signal_quality(2600, 8.5), "suspect")
        self.assertEqual(observation_quality(42.0), "valid")
        self.assertEqual(observation_quality(60.0), "suspect")
        self.assertEqual(observation_quality(-0.1), "suspect")

    def test_naive_source_timestamp_is_explicitly_marked_utc(self):
        self.assertEqual(utc_timestamp("2025-01-01 00:10:00"), "2025-01-01 00:10:00+00:00")
        self.assertEqual(utc_timestamp("2026-01-01"), utc_timestamp("2026-01-01 00:00:00"))


if __name__ == "__main__":
    unittest.main()
