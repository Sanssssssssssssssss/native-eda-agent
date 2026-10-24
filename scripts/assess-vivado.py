"""Assemble a scorecard from existing tool receipts; makes no model/API calls."""
from pathlib import Path
import datetime as dt
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
DESIGN = ROOT / "projects/fft-spectrum"
OUT = ROOT / "artifacts/codex-eda-assessment-20261023"
OUT.mkdir(exist_ok=True)
sim = Path((DESIGN / "latest-simulation.txt").read_text().strip())
impl = Path((DESIGN / "latest-implementation.txt").read_text().strip())
bench = ROOT / "artifacts/verilogeval-codex-2026-10-22T16-17-42-454Z/result.json"
aligned = ROOT / "artifacts/verilogeval-codex-2026-10-22T16-20-53-056Z/result.json"

def read(path):
    return json.loads(path.read_text(encoding="utf-8"))

def elapsed(path):
    text = path.read_text(encoding="utf-8")
    begin = re.search(r"Start of session at: (.+)", text)[1].strip()
    end = re.search(r"Exiting Vivado at (.+?)\.\.\.", text)[1].strip()
    fmt = "%a %b %d %H:%M:%S %Y"
    return (dt.datetime.strptime(end, fmt) - dt.datetime.strptime(begin, fmt)).total_seconds()

protocol = read(sim / "build-result.json")
numeric = read(sim / "oracle-result.json")
physical = read(impl / "build-result.json")
negative = read(sim / "negative-controls/result.json")
timing = dict(re.findall(r"checking (\w+) \((\d+)\)", (impl / "check-timing.rpt").read_text()))
assert len(timing) == 12 and all(int(n) == 0 for n in timing.values()), timing
route = (impl / "route-status.rpt").read_text()
routable = int(re.search(r"# of routable nets\.+\s*:\s*(\d+)", route)[1])
routed = int(re.search(r"# of fully routed nets\.+\s*:\s*(\d+)", route)[1])
route_errors = int(re.search(r"# of nets with routing errors\.+\s*:\s*(\d+)", route)[1])
assert routable == routed and route_errors == 0
assert physical["setup_slack_ns"] >= 0 and physical["hold_slack_ns"] >= 0
assert physical["black_boxes"] == 0 and physical["clock_period_ns"] == 10 and physical["io_delay_ns"] == 2
drc = (impl / "drc.rpt").read_text()
assert not re.search(r"\|\s*(?:Critical Warning|Error)\s*\|", drc)
util = (impl / "utilization.rpt").read_text()
slice_luts = int(re.search(r"\| Slice LUTs\s*\|\s*(\d+)", util)[1])
assert protocol["passed"] and numeric["passed"] and numeric["frames"] == 16 and numeric["bins_checked"] == 16384
assert negative["rejected"] == negative["total"] == 4
hashes = read(DESIGN / "acceptance-hashes.json")
assert all(hashlib.sha256((ROOT / p).read_bytes()).hexdigest() == h for p, h in hashes.items())
primary = read(bench)
assert primary["total"] == len(primary["tasks"]) == 8
passed = sum(t["passed"] for t in primary["tasks"])
repair = read(aligned)
assert repair["tasks"][0]["id"] == "Prob062_bugs_mux2" and repair["passed"] == 1
score = {
    "date": "2026-10-23", "executor": "Current Codex conversation driving local native tools",
    "additional_model_api_calls_after_user_stop": 0,
    "current_codex_token_usage": "Not exposed by this environment; not estimated",
    "verilog_eval_subset": {"upstream_commit": "c498220d0a52248f8e3fdffe279075215bde2da6",
        "seed": 20261023, "total": 8, "primary_passed": passed, "primary_percent": passed / 8 * 100,
        "test_samples": sum(t["samples"] for t in primary["tasks"]), "wall_seconds": primary["wall_seconds"],
        "diagnostic_reference_aligned_passed": 8,
        "diagnostic_note": "Only the failed mux was changed after inspecting the reference. This is not a blind repair score.",
        "runtime_adaptations": ["Reference copies prepend timescale 1ps/1ps", "Move tb_match/tb_mismatch declarations before dumpvars; no stimulus/check changes"],
        "official_harness": False, "full_benchmark": False, "primary_evidence": str(bench), "diagnostic_evidence": str(aligned)},
    "fft": {"upstream_commit": "c415ec77d296b38c2bb384141eb9952f1eb84344", "frames_passed": 16,
        "bins_checked": 16384, "max_component_error_lsb": max(t["max_complex_component_error_lsb"] for t in numeric["checks"]),
        "max_l1_error_lsb": max(t["max_l1_magnitude_error_lsb"] for t in numeric["checks"]),
        "protocol": protocol["protocol"], "negative_controls_rejected": 4, "simulation_wall_seconds": elapsed(sim / "vivado.log"),
        "implementation_wall_seconds": elapsed(impl / "vivado.log"), "implementation": physical,
        "slice_luts": slice_luts, "fully_routed_nets": routed, "route_errors": route_errors,
        "timing_check_issues": timing, "drc_errors": 0, "drc_warnings": ["CFGBVS-1: board configuration voltage unspecified"],
        "physical_timing_limitations": ["HD.CLK_SRC unset: external clock delay/skew not fully modeled", "HD.PARTPIN_LOCS unset: boundary port routes not fixed"],
        "timing_signoff": False,
        "acceptance_hashes_unchanged": True, "simulation_evidence": str(sim), "implementation_evidence": str(impl)},
}
(OUT / "score.json").write_text(json.dumps(score, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(json.dumps(score, indent=2, ensure_ascii=False))
