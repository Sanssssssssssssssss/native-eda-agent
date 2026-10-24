"""Independent acceptance checks for the provided physical/RTL examples."""
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path


def read_log(path: Path) -> str:
    data = path.read_bytes()
    return data.decode("utf-16" if data.startswith(b"\xff\xfe") else "utf-8", errors="replace")


def measurement(text: str, name: str) -> float:
    line = re.search(rf"(?im)^\s*{re.escape(name)}\s*:[^\r\n]*", text)
    assert line, f"Missing measurement {name}"
    number = r"([-+]?\d+(?:\.\d*)?(?:[eE][-+]?\d+)?)"
    if name == "cutoff_hz":
        match = re.search(r"\bAT\s*=?\s*" + number, line.group(), re.I)
    else:
        db = re.search(r"=\s*\(\s*" + number + r"\s*dB\s*,", line.group(), re.I)
        if db:
            return 10 ** (float(db.group(1)) / 20)
        match = re.search(r"=\s*" + number, line.group())
    assert match, f"Cannot parse measurement: {line.group()}"
    return float(match.group(1))


def verify_xsim(directory: Path) -> dict:
    text = read_log(directory / "process.log")
    assert "COUNTER_PASS checks=321 wraps=1 holds=7 resets=3" in text, "Testbench pass marker missing"
    assert "COUNTER_FAIL" not in text and "Fatal:" not in text, "Simulation failure"
    return {"passed": True, "checks": 321, "coverage": ["reset", "enable", "hold", "overflow"]}


def verify_vivado(directory: Path) -> dict:
    result = json.loads((directory / "build-result.json").read_text())
    assert result["stage"] == "routed", "Implementation not completed"
    assert result["setup_slack_ns"] >= 0 and result["hold_slack_ns"] >= 0, "Timing failure"
    assert result["flip_flops"] == 8, "Unexpected register count"
    timing = read_log(directory / "timing-summary.rpt")
    assert "All user specified timing constraints are met" in timing, "Timing report lacks success verdict"
    assert (directory / "counter-routed.dcp").stat().st_size > 0, "Missing routed checkpoint"
    return {"passed": True, **result}


def verify_analog(log: Path) -> dict:
    text = read_log(log)
    expected = {
        "cutoff_hz": (1 / (2 * math.pi * 1000 * 100e-9), 0.002),
        "gain_1k": (1 / math.sqrt(1 + (2 * math.pi * 1000 * 1000 * 100e-9) ** 2), 0.002),
        "v_at_tau": (1 - math.exp(-1), 0.002),
        "v_final": (1 - math.exp(-10), 0.002),
    }
    values = {}
    for name, (target, relative_tolerance) in expected.items():
        value = measurement(text, name)
        error = abs(value - target) / abs(target)
        assert math.isfinite(value) and error <= relative_tolerance, f"{name}: {value} vs expected {target}"
        values[name] = {"actual": value, "expected": target, "relative_error": error}
    return {"passed": True, "measurements": values}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--xsim", type=Path)
    parser.add_argument("--vivado", type=Path)
    parser.add_argument("--analog-log", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = {}
    if args.xsim: result["xsim"] = verify_xsim(args.xsim)
    if args.vivado: result["vivado"] = verify_vivado(args.vivado)
    if args.analog_log: result["analog"] = verify_analog(args.analog_log)
    assert result, "Choose at least one check"
    text = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
