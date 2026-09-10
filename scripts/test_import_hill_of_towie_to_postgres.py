import io
import unittest
import zipfile

from scripts.import_hill_of_towie_to_postgres import (
    build_month_rows,
    observation_quality,
    optional_bool,
    signal_quality,
    utc_timestamp,
)


class HillOfTowieImportTest(unittest.TestCase):
    def test_source_boolean_is_not_invented_when_blank(self):
        self.assertIsNone(optional_bool(""))
        self.assertTrue(optional_bool("1"))
        self.assertTrue(optional_bool("1.0"))
        self.assertFalse(optional_bool("0"))
        self.assertFalse(optional_bool("0.0"))

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

    def test_source_reduction_fields_do_not_fill_curtailment_label(self):
        archive_buffer = io.BytesIO()
        with zipfile.ZipFile(archive_buffer, "w") as archive:
            archive.writestr(
                "tblSCTurGrid_2025_01.csv",
                "TimeStamp,StationId,wtc_ActPower_mean\n2025-01-01 00:10:00,2304510,1200\n",
            )
            archive.writestr(
                "tblSCTurbine_2025_01.csv",
                "TimeStamp,StationId,wtc_AcWindSp_mean,wtc_PowerRef_endvalue\n2025-01-01 00:10:00,2304510,8.5,1800.0\n",
            )
            archive.writestr(
                "tblSCTurDigiIn_2025_01.csv",
                "TimeStamp,StationId,wtc_PowerRed_counts,wtc_PowerRed_endvalue,wtc_PowerRed_timeon\n2025-01-01 00:10:00,2304510,2,1.0,600\n",
            )
            archive.writestr(
                "tblSCTurFlag_2025_01.csv",
                "TimeStamp,StationId,wtc_ScInOper_timeon,wtc_ScReToOp_timeon,wtc_ScTurSto_timeon\n2025-01-01 00:10:00,2304510,600,600,0\n",
            )
            archive.writestr(
                "tblGridScientific_2025_01.csv",
                "TimeStamp,ActivePowerMean,ActiveEnergy,WPSStatus,DataOk\n2025-01-01 00:10:00,1.2,0.2,0,1\n",
            )
        archive_buffer.seek(0)
        with zipfile.ZipFile(archive_buffer) as readable_archive:
            signals, _observations = build_month_rows(
                readable_archive, 2025, 1, {"2304510": "T01"}
            )

        self.assertEqual(signals[0][-4:], (1800.0, True, 600.0, 2))
        self.assertIsNone(signals[0][9])


if __name__ == "__main__":
    unittest.main()
