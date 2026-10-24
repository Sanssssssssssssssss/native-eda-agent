"""Ensure the fixed numerical/frame oracle rejects deliberately corrupted results."""
import json
from pathlib import Path
import sys
import numpy as np
from oracle import check

source = Path(sys.argv[1]).resolve()
original = np.loadtxt(source, delimiter=",", skiprows=1, dtype=np.int64)
out = source.parent / "negative-controls"
out.mkdir(exist_ok=True)
results = []
for name in ("all_zero_outputs", "wrong_scaling", "missing_tlast", "missing_sample"):
    data = original.copy()
    if name == "all_zero_outputs": data[:, 2:5] = 0
    elif name == "wrong_scaling": data[:, 2:5] *= 2
    elif name == "missing_tlast": data[:, 5] = 0
    elif name == "missing_sample": data = data[:-1]
    path = out / f"{name}.csv"
    np.savetxt(path, data, fmt="%d", delimiter=",", header="frame,bin,re,im,mag,last,cycle", comments="")
    try:
        check(path, plot=False)
    except AssertionError as exc:
        results.append({"case": name, "rejected": True, "reason": str(exc)})
    else:
        raise AssertionError(f"Oracle accepted corrupted data: {name}")
(out / "result.json").write_text(json.dumps({"rejected": len(results), "total": 4, "checks": results}, indent=2) + "\n")
print(json.dumps(results, indent=2))
