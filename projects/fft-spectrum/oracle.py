"""Independent floating-point oracle; fixed before the Pi implementation run."""
from pathlib import Path
import json
import sys
import numpy as np

ROOT = Path(__file__).resolve().parent
N = 1024
SCALE = 2048
COMPLEX_TOLERANCE = 4.0
MAG_TOLERANCE = 8.0


def vectors():
    n = np.arange(N)
    rng = np.random.default_rng(20261023)
    cases = [
        ("zero_first_frame", np.zeros(N)),
        ("impulse", np.r_[32767, np.zeros(N - 1)]),
        ("dc_1000", np.full(N, 1000)),
        ("sine_bin64", 16383 * np.sin(2 * np.pi * 64 * n / N)),
        ("dual_64_173", 8000 * np.sin(2 * np.pi * 64 * n / N) + 7000 * np.sin(2 * np.pi * 173 * n / N)),
        ("nyquist", np.where(n % 2 == 0, 32767, -32768)),
        ("max_positive", np.full(N, 32767)),
        ("max_negative", np.full(N, -32768)),
        ("sine_first_after_midframe_reset", 16383 * np.sin(2 * np.pi * 37 * n / N)),
        ("chirp", 12000 * np.sin(2 * np.pi * (3 * n / N + 150 * (n / N) ** 2))),
    ]
    cases += [(f"random_{i}", rng.integers(-30000, 30001, N)) for i in range(6)]
    return [(name, np.rint(data).astype(np.int16)) for name, data in cases]


def generate():
    data = ROOT / "vectors"
    data.mkdir(exist_ok=True)
    cases = vectors()
    (data / "input.hex").write_text("".join(f"{int(x) & 65535:04x}\n" for _, frame in cases for x in frame), encoding="ascii")
    (data / "manifest.json").write_text(json.dumps({"n": N, "scale": SCALE, "seed": 20261023,
        "complex_tolerance_lsb": COMPLEX_TOLERANCE, "magnitude_tolerance_lsb": MAG_TOLERANCE,
        "cases": [name for name, _ in cases]}, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(cases)} frames, {len(cases) * N} input samples")


def check(csv_path, plot=True):
    rows = np.loadtxt(csv_path, delimiter=",", skiprows=1, dtype=np.int64)
    cases = vectors()
    assert rows.shape == (len(cases) * N, 7), f"Missing/extra outputs: {rows.shape}"
    reports = []
    for index, (name, data) in enumerate(cases):
        r = rows[index * N:(index + 1) * N]
        assert np.all(r[:, 0] == index), f"Wrong frame index {name}"
        assert np.array_equal(r[:, 1], np.arange(N)), f"Wrong bin sequence {name}"
        assert np.array_equal(r[:, 5], np.r_[np.zeros(N-1), 1]), f"Wrong TLAST {name}"
        expected = np.fft.fft(data.astype(float)) / SCALE
        actual = r[:, 2] + 1j * r[:, 3]
        re_err = np.max(np.abs(actual.real - expected.real))
        im_err = np.max(np.abs(actual.imag - expected.imag))
        mag = np.minimum(np.abs(expected.real) + np.abs(expected.imag), 65535)
        mag_err = np.max(np.abs(r[:, 4] - mag))
        # Independently checks the original L1 magnitude arithmetic, including signed values.
        assert np.array_equal(r[:, 4], np.minimum(np.abs(r[:, 2]) + np.abs(r[:, 3]), 65535)), name
        assert max(re_err, im_err) <= COMPLEX_TOLERANCE, f"FFT mismatch {name}: {re_err}, {im_err}"
        assert mag_err <= MAG_TOLERANCE, f"Magnitude mismatch {name}: {mag_err}"
        reports.append({"case": name, "samples": N, "max_complex_component_error_lsb": float(max(re_err, im_err)),
            "max_l1_magnitude_error_lsb": float(mag_err), "output_span_cycles": int(r[-1, 6] - r[0, 6] + 1), "passed": True})
    result = {"passed": True, "frames": len(cases), "bins_checked": len(rows),
        "oracle": "numpy.fft.fft(input)/2048; L1 magnitude", "checks": reports,
        "complex_tolerance_lsb": COMPLEX_TOLERANCE, "magnitude_tolerance_lsb": MAG_TOLERANCE}
    out = Path(csv_path).resolve().parent
    (out / "oracle-result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    if plot:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(2, 1, figsize=(12, 6), layout="constrained")
        for a, idx in zip(ax, [4, 10]):
            data = cases[idx][1]
            ref = np.fft.fft(data.astype(float)) / SCALE
            mag = np.abs(ref.real) + np.abs(ref.imag)
            a.plot(np.arange(N//2), mag[:N//2], color="#64748b", lw=2, label="NumPy reference")
            a.plot(np.arange(N//2), rows[idx*N:idx*N+N//2, 4], color="#0891b2", lw=0.9, label="Vivado XSim output")
            a.set(title=cases[idx][0], xlabel="FFT bin", ylabel="L1 magnitude (LSB)")
            a.grid(alpha=0.2); a.legend()
        fig.suptitle("1024-point FFT | 16-bit | scale 1/2048 | actual simulation vs independent reference")
        fig.savefig(out / "spectrum-comparison.png", dpi=150)
        plt.close(fig)
    print(json.dumps({"passed": True, "frames": len(cases), "bins_checked": len(rows),
        "worst_error_lsb": max(r["max_complex_component_error_lsb"] for r in reports), "output": str(out)}, indent=2))
    return result


if __name__ == "__main__":
    if len(sys.argv) == 1 or sys.argv[1] == "generate":
        generate()
    else:
        check(sys.argv[1])
