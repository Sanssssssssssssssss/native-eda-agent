#!/usr/bin/env python3
"""Run pinned ACE-RTL feedback components without a model or EDA transport.

The input history is the complete, ordered observation sequence, including its
current observation. The host verifier owns all acceptance and execution.
Upstream files stay unchanged; only their model-client dependency is replaced.
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
import sys
import types
from typing import Any

sys.dont_write_bytecode = True

UPSTREAM_COMMIT = "94754d796350d42502c9a32639a20d86f50e9678"
UPSTREAM_PACKAGE = Path("skills/ace-rtl/scripts/ace_rtl_agent")
SOURCE_HASHES = {
    "context_builder.py": "eb53d1e7b6285f67c6c6b364252541ddc593ff833bb44ca8445b8697276002ac",
    "fresh_start_coordinator.py": "14147b44ec76193c23eb416ec5d83794e940b86b5aaeb11dc2deeb1ef54d4e96",
}
MAX_INPUT_BYTES = 1024 * 1024
MAX_RTL_BYTES = 96 * 1024
MAX_SPEC_BYTES = 16 * 1024
MAX_REPORT_BYTES = 16 * 1024
MAX_HISTORY = 8
MAX_CONTEXT_CHARS = 12000
MAX_REASON_CHARS = 1200
DEFAULT_VENDOR = Path(__file__).resolve().parents[1] / "vendor" / "ace-rtl"


class FeedbackError(ValueError):
    """An invalid input or unavailable pinned dependency prevents feedback."""


class ModelCallsDisabled(RuntimeError):
    """The upstream component requested a model; the host must handle it."""


def _text(value: Any, name: str, maximum: int) -> str:
    if not isinstance(value, str):
        raise FeedbackError(f"{name} must be a string")
    if len(value.encode("utf-8")) > maximum:
        raise FeedbackError(f"{name} exceeds {maximum} UTF-8 bytes")
    return value


def validate_input(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise FeedbackError("Input must be a JSON object")
    allowed = {"specification", "rtl_code", "error_report", "history"}
    if set(payload) - allowed:
        raise FeedbackError("Unknown feedback input fields")
    specification = _text(payload.get("specification", ""), "specification", MAX_SPEC_BYTES)
    rtl = _text(payload.get("rtl_code", ""), "rtl_code", MAX_RTL_BYTES)
    report = _text(payload.get("error_report", ""), "error_report", MAX_REPORT_BYTES)
    history = payload.get("history", [])
    if not isinstance(history, list) or len(history) > MAX_HISTORY:
        raise FeedbackError(f"history must contain at most {MAX_HISTORY} observations")
    observations = []
    for index, item in enumerate(history):
        if not isinstance(item, dict):
            raise FeedbackError("Each history observation must be an object")
        passed = item.get("test_passed", False)
        mismatches = item.get("mismatch_count", -1)
        if not isinstance(passed, bool):
            raise FeedbackError("test_passed must be boolean")
        if type(mismatches) is not int or not -1 <= mismatches <= 100000000:
            raise FeedbackError("mismatch_count must be an integer between -1 and 100000000")
        observations.append({
            "iteration": index + 1,
            "rtl_code": _text(item.get("rtl_code", ""), "history.rtl_code", MAX_RTL_BYTES),
            "error_report": _text(item.get("error_report", ""), "history.error_report", MAX_REPORT_BYTES),
            "test_passed": passed,
            "mismatch_count": mismatches,
        })
    if observations:
        if observations[-1]["rtl_code"] != rtl or observations[-1]["error_report"] != report:
            raise FeedbackError("history must end with the current rtl_code and error_report")
    else:
        observations = [{"iteration": 1, "rtl_code": rtl, "error_report": report,
                         "test_passed": False, "mismatch_count": -1}]
    return {"specification": specification, "rtl_code": rtl, "error_report": report,
            "history": observations}


def load_upstream(vendor_root: Path | None = None):
    """Load two verified source files; never run upstream package initialization.

    Git's Windows checkout may use CRLF. Hash the source with normalized LF,
    matching the fixed upstream blobs, before executing either component.
    """
    vendor = Path(vendor_root) if vendor_root is not None else DEFAULT_VENDOR
    package_dir = vendor / UPSTREAM_PACKAGE
    sources = {}
    for filename, expected in SOURCE_HASHES.items():
        try:
            source = (package_dir / filename).read_text(encoding="utf-8")
        except (OSError, UnicodeError) as error:
            raise FeedbackError(f"Pinned ACE-RTL source unavailable: {filename}") from error
        if hashlib.sha256(source.encode("utf-8")).hexdigest() != expected:
            raise FeedbackError(f"Pinned ACE-RTL source mismatch: {filename}")
        sources[filename] = source

    gate = {"blocked_model_requests": 0, "transport_calls": 0}

    class DisabledModelClient:
        def __init__(self, *args, **kwargs):
            # Do not import a provider, resolve a model, or read credentials.
            pass

        def call_llm(self, *args, **kwargs):
            gate["blocked_model_requests"] += 1
            raise ModelCallsDisabled("Additional model calls are disabled; defer this role to Pi")

    namespace = "_eda_ace_feedback"
    for suffix, directory in [("", package_dir), (".utils", package_dir / "utils")]:
        name = namespace + suffix
        module = types.ModuleType(name)
        module.__path__ = [str(directory)]
        sys.modules[name] = module
    for module_name, class_name in [("llm_client", "LLMClient"), ("ace_model_client", "AceRTLClient")]:
        name = namespace + ".utils." + module_name
        module = types.ModuleType(name)
        setattr(module, class_name, DisabledModelClient)
        sys.modules[name] = module
    loaded = {}
    for filename, source in sources.items():
        name = namespace + "." + Path(filename).stem
        module = types.ModuleType(name)
        module.__package__ = namespace
        module.__file__ = str(package_dir / filename)
        sys.modules[name] = module
        exec(compile(source, module.__file__, "exec"), module.__dict__)
        loaded[filename] = module
    return (loaded["context_builder.py"].ContextBuilder,
            loaded["fresh_start_coordinator.py"].FreshStartCoordinator, gate)


def process_feedback(payload: Any, *, vendor_root: Path | None = None) -> dict[str, Any]:
    data = validate_input(payload)
    ContextBuilder, FreshStartCoordinator, gate = load_upstream(vendor_root)
    logger = logging.getLogger("eda.ace_feedback")
    logger.addHandler(logging.NullHandler())
    logger.propagate = False
    builder = ContextBuilder(logger)
    coordinator = FreshStartCoordinator("host-pi-role-only", logger)
    for item in data["history"]:
        coordinator.add_iteration_result(**item)
    iteration = len(data["history"])
    context = builder.build_context(
        specification=data["specification"], error_report=data["error_report"],
        rtl_code=data["rtl_code"], iteration=iteration, testbench_code=None,
    )
    should_restart, reason = coordinator.should_fresh_start(iteration)
    deferred = gate["blocked_model_requests"] > 0
    if deferred:
        should_restart = False
        reason = "Upstream requested an additional model; no request was sent. Defer the role to the current Pi session."
    return {
        "schema_version": 1,
        "upstream_commit": UPSTREAM_COMMIT,
        "source_hashes": SOURCE_HASHES,
        "source_hash_basis": "UTF-8 source with LF line endings",
        "component_names": ["ContextBuilder.build_context", "FreshStartCoordinator.add_iteration_result",
                            "FreshStartCoordinator.should_fresh_start"],
        "context": context[:MAX_CONTEXT_CHARS],
        "context_truncated": len(context) > MAX_CONTEXT_CHARS,
        "decision": {"should_restart": bool(should_restart), "reason": str(reason)[:MAX_REASON_CHARS],
                     "status": "deferred_to_pi" if deferred else "fresh_start_advised" if should_restart else "continue",
                     "deferred_to_pi": deferred, "automatic_restart": False},
        "observations": len(coordinator.iteration_history),
        "model_api_calls": 0,
        **gate,
        "boundary": "Original upstream components executed with model transport disabled. Advice cannot override host verification or authorize EDA.",
    }


def main() -> int:
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        if len(raw) > MAX_INPUT_BYTES:
            raise FeedbackError(f"Input exceeds {MAX_INPUT_BYTES} bytes")
        payload = json.loads(raw.decode("utf-8"))
        result = process_feedback(payload)
    except (FeedbackError, UnicodeError, json.JSONDecodeError) as error:
        result = {"schema_version": 1, "error": str(error)[:MAX_REASON_CHARS],
                  "status": "unavailable", "upstream_commit": UPSTREAM_COMMIT,
                  "model_api_calls": 0, "transport_calls": 0}
        print(json.dumps(result, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
