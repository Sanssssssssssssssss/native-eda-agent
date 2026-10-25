"""Offline checks execute the pinned upstream components, with no provider."""

import importlib.util
import inspect
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "ace-rtl-feedback.py"
spec = importlib.util.spec_from_file_location("eda_ace_feedback_bridge", SCRIPT)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def payload(report="Mismatch: expected q=1 got q=2", count=1):
    rtl = "module TopModule(input logic d, output logic q); assign q=d; endmodule"
    return {"specification": "Combinational pass-through with explicit signal widths.",
            "rtl_code": rtl, "error_report": report,
            "history": [{"rtl_code": rtl, "error_report": report, "test_passed": False,
                         "mismatch_count": 1} for _ in range(count)]}


class AceRTLFeedbackTests(unittest.TestCase):
    def test_original_classes_execute_without_transport_or_credentials(self):
        original_getitem = type(os.environ).__getitem__

        def no_credentials(environ, key):
            if any(word in str(key).upper() for word in ("API_KEY", "TOKEN", "SECRET", "PASSWORD")):
                raise AssertionError("A credential was read")
            return original_getitem(environ, key)

        with patch.object(type(os.environ), "__getitem__", no_credentials), \
                patch.object(socket, "socket", side_effect=AssertionError("Network attempted")), \
                patch.object(subprocess, "Popen", side_effect=AssertionError("Subprocess attempted")):
            builder, coordinator, gate = bridge.load_upstream()
            expected = bridge.DEFAULT_VENDOR / bridge.UPSTREAM_PACKAGE
            self.assertEqual(Path(inspect.getfile(builder)), expected / "context_builder.py")
            self.assertEqual(Path(inspect.getfile(coordinator)), expected / "fresh_start_coordinator.py")
            result = bridge.process_feedback(payload())
        self.assertEqual(result["decision"]["status"], "continue")
        self.assertIn("minimum 12", result["decision"]["reason"])
        self.assertEqual(result["observations"], 1)
        self.assertEqual(result["transport_calls"], 0)
        self.assertEqual(result["blocked_model_requests"], 0)
        self.assertEqual(gate["transport_calls"], 0)
        self.assertIn("ContextBuilder.build_context", result["component_names"])

    def test_original_zero_output_heuristic_advises_restart_without_running_it(self):
        result = bridge.process_feedback(payload("Mismatch: output is all zeros", 3))
        self.assertTrue(result["decision"]["should_restart"])
        self.assertIn("Three consecutive", result["decision"]["reason"])
        self.assertFalse(result["decision"]["automatic_restart"])
        self.assertEqual(result["model_api_calls"], 0)
        self.assertEqual(result["blocked_model_requests"], 0)

    def test_missing_or_changed_upstream_fails_closed(self):
        with tempfile.TemporaryDirectory(prefix="eda-ace-feedback-") as directory:
            vendor = Path(directory)
            with self.assertRaisesRegex(bridge.FeedbackError, "unavailable"):
                bridge.process_feedback(payload(), vendor_root=vendor)
            target = vendor / bridge.UPSTREAM_PACKAGE
            target.mkdir(parents=True)
            for filename in bridge.SOURCE_HASHES:
                source = (bridge.DEFAULT_VENDOR / bridge.UPSTREAM_PACKAGE / filename).read_text(encoding="utf-8")
                (target / filename).write_text(source, encoding="utf-8")
            changed = target / "context_builder.py"
            changed.write_text(changed.read_text(encoding="utf-8") + "\n# modified\n", encoding="utf-8")
            with self.assertRaisesRegex(bridge.FeedbackError, "source mismatch"):
                bridge.process_feedback(payload(), vendor_root=vendor)

    def test_history_is_bounded_and_must_end_with_current_observation(self):
        for invalid in [payload(count=9), {**payload(), "rtl_code": "new candidate"},
                        {**payload(), "error_report": "x" * (bridge.MAX_REPORT_BYTES + 1)},
                        {**payload(), "rtl_code": "汉" * (bridge.MAX_RTL_BYTES // 3 + 1)},
                        {**payload(), "harness_folder": "private"}]:
            with self.subTest(fields=tuple(invalid)):
                with self.assertRaises(bridge.FeedbackError):
                    bridge.process_feedback(invalid)
        data = payload(count=8)
        for item in data["history"]:
            item["iteration"] = 999  # Caller counters cannot force paid coordinator analysis.
        result = bridge.process_feedback(data)
        self.assertEqual(result["observations"], 8)
        self.assertEqual(result["blocked_model_requests"], 0)

    def test_context_truncation_is_explicit(self):
        data = payload("AssertionError: expected 4 got 0")
        with patch.object(bridge, "MAX_CONTEXT_CHARS", 80):
            result = bridge.process_feedback(data)
        self.assertEqual(len(result["context"]), 80)
        self.assertTrue(result["context_truncated"])
        self.assertLessEqual(len(result["decision"]["reason"]), bridge.MAX_REASON_CHARS)

    def test_attempted_upstream_model_request_is_explicitly_deferred(self):
        builder, coordinator, gate = bridge.load_upstream()

        class ForceLateCoordinator(coordinator):
            def should_fresh_start(self, current_iteration):
                return super().should_fresh_start(12)

        with patch.object(bridge, "load_upstream", return_value=(builder, ForceLateCoordinator, gate)):
            result = bridge.process_feedback(payload())
        self.assertEqual(result["blocked_model_requests"], 1)
        self.assertEqual(result["decision"]["status"], "deferred_to_pi")
        self.assertFalse(result["decision"]["should_restart"])
        self.assertEqual(result["transport_calls"], 0)
        self.assertEqual(result["model_api_calls"], 0)

    def test_cli_emits_one_json_receipt_and_rejects_oversized_input(self):
        good = subprocess.run([sys.executable, "-B", str(SCRIPT)], input=json.dumps(payload()),
                              capture_output=True, text=True, cwd=ROOT, timeout=15)
        self.assertEqual(good.returncode, 0, good.stderr)
        self.assertEqual(json.loads(good.stdout)["upstream_commit"], bridge.UPSTREAM_COMMIT)
        bad = subprocess.run([sys.executable, "-B", str(SCRIPT)],
                             input=" " * (bridge.MAX_INPUT_BYTES + 1), capture_output=True,
                             text=True, cwd=ROOT, timeout=15)
        self.assertEqual(bad.returncode, 2)
        self.assertEqual(json.loads(bad.stdout)["status"], "unavailable")
        self.assertNotIn("Traceback", bad.stderr)


if __name__ == "__main__":
    unittest.main()
