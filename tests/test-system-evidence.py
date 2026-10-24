"""Negative checks for false success in historical EDA evidence."""
import importlib.util
import json
import os
import pathlib
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts/collect-system-evidence.py"
SPEC = importlib.util.spec_from_file_location("system_evidence", SCRIPT)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class EvidenceTests(unittest.TestCase):
    def test_zero_exit_and_partial_cases_are_not_success(self):
        verdict = module.assess("dma", "sim", "DMA_CASE_PASS case=0\nFatal: DMA_GUARD_OVERWRITE case=716\n",
                                {"exit_code": 0, "pass": False}, {}, {})
        self.assertEqual(verdict["status"], "failed")

    def test_pass_marker_cannot_hide_fatal_or_timeout(self):
        for error in ("Fatal: mismatch", "TIMEOUT"):
            verdict = module.assess("soc", "sim", "SYSTEM_BENCH_PASS project=soc scenarios=4\n" + error,
                                    {"exit_code": 0, "pass": True}, {}, {})
            self.assertEqual(verdict["status"], "failed")

    def test_wrong_negative_failure_is_not_expected_rejection(self):
        verdict = module.assess("aes", "negative", "ERROR: compile failed\n", {"exit_code": 1}, {}, {})
        self.assertEqual(verdict["status"], "failed")
        verdict = module.assess("dma", "negative", "Fatal: DMA_DATA case=0 offset=0\n", {}, {}, {})
        self.assertEqual(verdict["status"], "failed")

    def test_expected_rejection_and_positive_are_separate(self):
        log = "NEGATIVE_INJECTION destination_bit_flipped\nFatal: DMA_DATA case=0 offset=0\n"
        self.assertEqual(module.assess("dma", "negative", log, {}, {}, {})["status"], "expected_rejection")
        self.assertEqual(module.assess("dma", "sim", log, {}, {}, {})["status"], "failed")

    def test_missing_or_mismatched_timing_never_passes(self):
        build = {"stage": "routed", "setup_slack_ns": 1.0, "hold_slack_ns": 0.1}
        for timing in ({}, {"setup_slack_ns": 1.0, "hold_slack_ns": -0.1}):
            self.assertNotEqual(module.assess("soc", "impl", "SYSTEM_IMPLEMENTATION_PASS soc_top", {}, build, timing)["status"], "passed")

    def test_missing_log_and_duplicate_marker_never_pass(self):
        log = "SYSTEM_BENCH_PASS project=soc scenarios=4\n"
        self.assertNotEqual(module.assess("soc", "sim", log, {}, {}, {}, False)["status"], "passed")
        self.assertNotEqual(module.assess("soc", "sim", log * 2, {}, {}, {})["status"], "passed")

    def test_capture_records_missing_and_malformed_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            capture = module.Capture(root)
            self.assertIsNone(capture.json(root / "missing.json"))
            (root / "broken.json").write_text('{"in_progress":', encoding="utf-8")
            self.assertIsNone(capture.json(root / "broken.json"))
            self.assertEqual(capture.files[str(root / "missing.json")]["status"], "missing")
            self.assertIn("parse_error", capture.files[str(root / "broken.json")])

    def test_timeout_identifier_and_terminal_evidence(self):
        verdict = module.assess("soc", "sim", "Fatal: SOC_TIMEOUT_OR_MISSING_OUTPUT case=3 outputs=1", {}, {}, {})
        self.assertTrue(verdict["timeout_observed"])
        log = "SYSTEM_BENCH_PASS project=soc scenarios=4\n"
        self.assertNotEqual(module.assess("soc", "sim", log, {}, {}, {})["status"], "passed")
        self.assertEqual(module.assess("soc", "sim", log + "INFO: Exiting xsim at time", {}, {}, {})["status"], "passed")

    def test_history_survives_latest_and_missing_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            folder = root / "projects/system-bench/soc"
            folder.mkdir(parents=True)
            runs = []
            for stamp, log in (("01", "Fatal: SOC_TIMEOUT case=0"),
                               ("02", "SYSTEM_BENCH_PASS project=soc scenarios=4\nINFO: Exiting xsim at time")):
                tool = "xsim" if stamp == "01" else "eda_xsim"
                run = root / "artifacts" / f"2026-10-22T18-00-{stamp}-000Z-{tool}-run"
                run.mkdir(parents=True)
                (run / "inputs.json").write_text(json.dumps({"sources": ["projects/system-bench/soc/tb_soc.sv"]}))
                (run / "process.log").write_text(log)
                runs.append(run)
            (folder / "latest-sim.json").write_text(json.dumps({"artifact_directory": str(runs[1]), "pass": True, "exit_code": 0}))
            pending = root / "artifacts/system-soc-sim-20261022T180003Z"
            pending.mkdir()
            (pending / "invocation.log").write_text("")
            data = module.collect(root)
            self.assertEqual(len(data["runs"]), 2)
            self.assertEqual({r["verdict"]["status"] for r in data["runs"]}, {"passed", "failed"})
            self.assertEqual(data["unlinked_receipts"][0]["status"], "in_progress_or_interrupted")
            self.assertTrue(any(r["project"] == "aes" and r["stage"] == "impl" and r["status"] == "missing" for r in data["summary"]))

    def test_ordering_prefers_recorded_start_then_log_then_iso_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            directory = root / "2026-10-22T18-10-00-000Z-eda_xsim-case"
            directory.mkdir()
            capture = module.Capture(root)
            trace = {"started_at": "2026-10-23T02:12:00+08:00"}
            log = '[2026-10-22T18:11:00.000Z] ["xsim"]\n'
            item = module.ordering(capture, directory, trace, [], None, log)
            self.assertEqual(item["ordering_timestamp_utc"], "2026-10-22T18:12:00.000000+00:00")
            self.assertEqual(item["ordering_basis"], "explicit_start:started_at")
            item = module.ordering(capture, directory, {}, [], None, log)
            self.assertEqual(item["ordering_basis"], "process_log_timestamp")
            self.assertIn("18:11:00", item["ordering_timestamp_utc"])
            item = module.ordering(capture, directory, {}, [], None, "")
            self.assertEqual(item["ordering_basis"], "artifact_directory_timestamp")
            self.assertIn("18:10:00", item["ordering_timestamp_utc"])

    def test_direct_history_survives_latest_and_later_iso_run_sorts_after_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            folder = root / "projects/system-bench/aes"
            folder.mkdir(parents=True)
            direct = root / "artifacts/aes-direct-182000"
            direct.mkdir(parents=True)
            (direct / "result.json").write_text(json.dumps({"project": "aes", "stage": "sim", "pass": True, "exit_code": 0}))
            command = direct / "command.json"
            command.write_text(json.dumps({"argv": ["xsim"], "cwd": str(direct)}))
            timestamp = module.dt.datetime(2026, 10, 22, 18, 20, tzinfo=module.dt.timezone.utc).timestamp()
            os.utime(command, (timestamp, timestamp))
            (direct / "source-manifest.json").write_text(json.dumps({"source_sha256": {"input.sv": "declared-original-hash"}}))
            log = "SYSTEM_BENCH_PASS project=aes blocks=1\nINFO: Exiting xsim at time"
            (direct / "process.log").write_text(log)
            newer = root / "artifacts/2026-10-22T18-30-00-000Z-eda_xsim-newer"
            newer.mkdir()
            (newer / "inputs.json").write_text(json.dumps({"sources": ["projects/system-bench/aes/tb_aes.sv"]}))
            (newer / "process.log").write_text(log)
            (folder / "latest-sim.json").write_text(json.dumps({"artifact_directory": str(newer), "pass": True, "exit_code": 0}))
            data = module.collect(root)
            self.assertEqual(len(data["runs"]), 2)
            direct_run = next(r for r in data["runs"] if r["artifact_directory"] == str(direct))
            self.assertEqual(direct_run["ordering_basis"], "file_mtime_only_not_run_start")
            self.assertEqual(direct_run["ordering_source"], str(command))
            self.assertEqual(direct_run["command_record"]["payload"]["argv"], ["xsim"])
            self.assertEqual(direct_run["source_manifest_record"]["payload"]["source_sha256"]["input.sv"], "declared-original-hash")
            self.assertFalse(direct_run["latest_pointer_paths"])
            summary = next(r for r in data["summary"] if r["project"] == "aes" and r["stage"] == "sim")
            self.assertEqual(summary["newest_retained_artifact"], str(newer))
            self.assertEqual(summary["retained_attempts"], 2)
            self.assertEqual(summary["ordering_basis"], "artifact_directory_timestamp")
            for name in ("command.json", "source-manifest.json"):
                record = next(f for f in data["files"] if f["path"] == str(direct / name))
                self.assertEqual(record["status"], "captured")
                self.assertEqual(len(record["sha256"]), 64)


if __name__ == "__main__":
    unittest.main()
