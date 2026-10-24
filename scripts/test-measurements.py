"""Regression against real LTspice 26.1.1 output and deliberate bad data."""
import importlib.util
import math
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("verify", root / "scripts/verify-results.py")
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)
fixture = root / "tests/fixtures/ltspice-26.1.1.log"
text = fixture.read_text(encoding="utf-8")
assert verify.verify_analog(fixture)["passed"]
assert math.isclose(verify.measurement("gain_1k: mag(V(out))=0.846733015965 at 1000", "gain_1k"), 0.846733015965)
with tempfile.TemporaryDirectory() as temp:
    bad = Path(temp) / "bad.log"
    bad.write_text(text.replace("-1.44507011621dB", "-6.020599913dB"), encoding="utf-8")
    try:
        verify.verify_analog(bad)
    except AssertionError:
        pass
    else:
        raise AssertionError("Incorrect gain was accepted")
print("PASS: real dB output, linear output, and incorrect-gain rejection")
