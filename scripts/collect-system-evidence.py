"""Index all retained system-bench attempts without executing EDA or model tools."""
import argparse
import collections
import datetime as dt
import hashlib
import json
import pathlib
import platform
import re
import sys
import uuid

PROJECTS = ("soc", "dma", "udp", "aes")
ERROR = re.compile(r"^\s*(?:fatal:|error:|error\s*\[|.*\bTIMEOUT\b|couldn't read file|synth_design failed)", re.I)
EXPECTED = {
    "soc": r"Fatal: SOC_MISMATCH case=0 result=0\b",
    "dma": r"Fatal: DMA_DATA case=0 offset=0\b",
    "udp": r"Fatal: TX mismatch packet=0 byte=10\b",
    "aes": r"Fatal: AES mismatch block=0 group=0\b",
}
KEY_FILES = {"inputs.json", "receipt.json", "result.json", "build-result.json", "manifest.json", "run.json", "events.jsonl",
             "command.json", "source-manifest.json", "process.log", "invocation.log", "invoked.tcl", "waves.tcl", "applied-constraints.xdc"}


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


class Capture:
    def __init__(self, root):
        self.root = root.resolve()
        self.files = {}
        self.content = {}

    def path(self, value):
        p = pathlib.Path(value)
        return (p if p.is_absolute() else self.root / p).resolve()

    def read(self, value):
        p = self.path(value)
        key = str(p)
        if key in self.content:
            return self.content[key]
        item = {"path": key, "captured_at_utc": utc(), "hash_scope": "bytes_read_at_collection_only"}
        self.files[key] = item
        try:
            p.relative_to(self.root)
            before = p.stat()
            data = p.read_bytes()
            after = p.stat()
            item.update(status="captured", sha256=hashlib.sha256(data).hexdigest(), bytes=len(data),
                        mtime_utc=dt.datetime.fromtimestamp(after.st_mtime, dt.timezone.utc).isoformat(),
                        changed_during_read=(before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns))
        except (OSError, ValueError) as exc:
            item.update(status="missing" if isinstance(exc, FileNotFoundError) else "unreadable", error=str(exc))
            data = b""
        self.content[key] = data
        return data

    def text(self, value):
        return self.read(value).decode("utf-8-sig", errors="replace")

    def json(self, value):
        text = self.text(value)
        if not text:
            return None
        try:
            result = json.loads(text)
            if not isinstance(result, dict):
                raise ValueError("expected a JSON object")
            return result
        except (ValueError, TypeError) as exc:
            self.files[str(self.path(value))]["parse_error"] = str(exc)
            return None


def markers(text, pattern):
    return [{"line": number, "text": line, "fields": dict(re.findall(r"(\w+)=([^\s]+)", line))}
            for number, line in enumerate(text.splitlines(), 1) if re.search(pattern, line)]


def report_timing(text):
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if "WNS(ns)" in line and "WHS(ns)" in line:
            for candidate in lines[index + 1:index + 5]:
                fields = candidate.split()
                if len(fields) >= 8:
                    try:
                        values = [float(x) for x in fields]
                        return {"header_line": index + 1, "setup_slack_ns": values[0], "setup_total_slack_ns": values[1],
                                "setup_failing_endpoints": int(values[2]), "hold_slack_ns": values[4],
                                "hold_total_slack_ns": values[5], "hold_failing_endpoints": int(values[6])}
                    except ValueError:
                        pass
    return {}


def ordering(capture, directory, trace, result_records, command, log):
    """Choose an ordering observation without inventing a run's start/end time."""
    def point(value, basis, source):
        try:
            instant = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
            if instant.tzinfo is None:
                return None
        except (AttributeError, TypeError, ValueError):
            return None
        return {"ordering_timestamp_utc": instant.astimezone(dt.timezone.utc).isoformat(timespec="microseconds"),
                "ordering_basis": basis, "ordering_source": str(source), "ordering_original_value": value}

    metadata = [(directory / "run.json", trace), (directory / "command.json", command)]
    metadata += [(record["path"], record["payload"]) for record in result_records]
    for source, payload in metadata:
        for key in ("started_at", "started_at_utc", "startedAt", "start_time_utc"):
            value = point((payload or {}).get(key), f"explicit_start:{key}", source)
            if value:
                return value
    for match in re.finditer(r"^\[(\d{4}-\d{2}-\d{2}T[^\]\r\n]+)\]", log, re.M):
        value = point(match[1], "process_log_timestamp", directory / "process.log")
        if value:
            return value
    match = re.match(r"(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3,6}))?Z(?:-|$)", directory.name)
    if match:
        day, hour, minute, second, fraction = match.groups()
        value = point(f"{day}T{hour}:{minute}:{second}.{fraction or '0'}Z", "artifact_directory_timestamp", directory)
        if value:
            return value
    for name in ("command.json", "run.json", "result.json", "inputs.json", "invoked.tcl", "source-manifest.json", "receipt.json", "process.log"):
        source = directory / name
        if source.exists():
            capture.read(source)
            value = point(capture.files[str(source)].get("mtime_utc"), "file_mtime_only_not_run_start", source)
            if value:
                return value
    return {"ordering_timestamp_utc": None, "ordering_basis": "unavailable", "ordering_source": None,
            "ordering_original_value": None}


def ordering_key(run):
    return (run["ordering_timestamp_utc"] or "", run["artifact_directory"])


def assess(project, stage, log, result, build, timing, required_present=True):
    """Pass requires independent terminal evidence; a zero process exit is insufficient."""
    errors = [x for x in markers(log, ERROR) if not re.search(r"Parameter \w+ bound to:", x["text"])]
    passes = markers(log, rf"^SYSTEM_BENCH_PASS project={project}\b")
    impl_passes = markers(log, r"^SYSTEM_IMPLEMENTATION_PASS\b")
    timed_out = any(re.search(r"timeout|timed out", x["text"], re.I) for x in errors)
    expected = [x for x in errors if re.search(EXPECTED[project], x["text"], re.I)]
    reasons = []
    exit_code = result.get("exit_code", result.get("tool_exit_code")) if result else None
    terminal = bool(re.search(r"Exiting (?:xsim|Vivado)\b", log)) or (exit_code == 0 and result.get("pass") is True)
    if stage == "negative":
        rejection = bool(expected) and len(expected) == len(errors) and not passes and not timed_out
        if project == "dma":
            rejection = rejection and "NEGATIVE_INJECTION destination_bit_flipped" in log
        status = "expected_rejection" if rejection else "failed" if errors or result else "in_progress_or_interrupted"
        if not rejection:
            reasons.append("specific injected-fault rejection not established")
    elif errors or (exit_code is not None and exit_code != 0):
        status = "failed"
        reasons.append("error, timeout, or nonzero exit recorded")
    elif result and result.get("pass") is False:
        status = "failed"
        reasons.append("runner recorded pass=false")
    elif stage == "sim":
        status = "passed" if len(passes) == 1 and required_present and terminal else "incomplete" if result else "in_progress_or_interrupted"
        if status != "passed":
            reasons.append("one complete pass marker, terminal evidence and stable log required")
    else:
        numeric = all(isinstance(build.get(k), (int, float)) and build[k] >= 0
                      and isinstance(timing.get(k), (int, float)) and timing[k] >= 0
                      and abs(build[k] - timing[k]) < 0.0011 for k in ("setup_slack_ns", "hold_slack_ns"))
        passed = build.get("stage") == "routed" and numeric and len(impl_passes) == 1 and required_present and terminal
        negative_slack = any(isinstance(build.get(k), (int, float)) and build[k] < 0 for k in ("setup_slack_ns", "hold_slack_ns"))
        status = "passed" if passed else "failed" if negative_slack else "incomplete" if result or build else "in_progress_or_interrupted"
        if status != "passed":
            reasons.append("routed marker, matching nonnegative setup/hold reports, constraints and stable log required")
    return {"status": status, "reasons": reasons, "exit_code": exit_code, "timeout_observed": timed_out, "terminal_observed": terminal,
            "errors": errors, "pass_markers": passes, "implementation_pass_markers": impl_passes,
            "expected_rejection_markers": expected}


def collect(root):
    capture = Capture(root)
    root = capture.root
    artifacts = root / "artifacts"
    bench = root / "projects/system-bench"
    attempts = {}
    unlinked = []
    latest = []

    def add(directory, project, stage):
        key = str(capture.path(directory))
        return attempts.setdefault(key, {"artifact_directory": key, "project": project, "stage": stage,
                                          "result_records": [], "latest_pointer_paths": [], "receipt_directories": []})

    def attach(path, project, stage, wrapper=None, is_latest=False, fallback_directory=None):
        result = capture.json(path)
        invocation = capture.text(wrapper / "invocation.log") if wrapper else ""
        directory = (result or {}).get("artifact_directory")
        process_log = (result or {}).get("process_log")
        if process_log and not directory:
            directory = str(capture.path(process_log).parent)
        if not directory or directory == "None":
            match = re.search(r"(?:log:|inspect)\s+([^\r\n]+[\\/]process\.log)", invocation)
            if match:
                directory = str(capture.path(match[1]).parent)
        if (not directory or directory == "None") and fallback_directory is not None:
            directory = str(fallback_directory)
        record = {"path": str(path), "payload": result}
        if is_latest:
            latest.append({"project": project, "stage": stage, **record})
        if directory and directory != "None":
            attempt = add(directory, project, stage)
            attempt["result_records"].append(record)
            if is_latest:
                attempt["latest_pointer_paths"].append(str(path))
            if wrapper:
                attempt["receipt_directories"].append(str(wrapper))
        elif wrapper or result is not None:
            unlinked.append({"project": project, "stage": stage, "receipt_directory": str(wrapper) if wrapper else None,
                             "result": record, "status": "failed" if result and result.get("pass") is False else "in_progress_or_interrupted",
                             "note": "No evidence-backed artifact link; process liveness not established."})

    for project in PROJECTS:
        folder = bench / project
        for stage in ("sim", "impl", "negative"):
            path = folder / f"latest-{stage}.json"
            if path.exists():
                attach(path, project, stage, is_latest=True)
            else:
                capture.read(path)
                latest.append({"project": project, "stage": stage, "path": str(path), "payload": None})
        for path in folder.glob("*-result.json"):
            attach(path, project, "negative" if "negative" in path.name else "sim")
        for wrapper in sorted(artifacts.glob(f"system-{project}-*")):
            match = re.match(rf"system-{project}-(sim|impl|negative)-", wrapper.name)
            if wrapper.is_dir() and match:
                attach(wrapper / "result.json", project, match[1], wrapper)

    # Discover orphaned/failed tools even when a wrapper never wrote result.json.
    for directory in sorted(artifacts.iterdir()):
        if not directory.is_dir():
            continue
        direct = re.match(r"^(soc|dma|udp|aes)-direct-", directory.name)
        if direct:
            result = capture.json(directory / "result.json")
            stage = (result or {}).get("stage")
            if stage == "negative_control":
                stage = "negative"
            if stage in ("sim", "impl", "negative"):
                attach(directory / "result.json", direct[1], stage, fallback_directory=directory)
            else:
                unlinked.append({"project": direct[1], "stage": stage, "receipt_directory": str(directory),
                                 "result": {"path": str(directory / "result.json"), "payload": result},
                                 "status": "incomplete", "note": "Direct artifact lacks a readable result with an identified stage."})
            continue
        if not re.search(r"-(?:eda_)?(xsim|vivado)-", directory.name):
            continue
        identity = ""
        for name in ("inputs.json", "invoked.tcl"):
            if (directory / name).exists():
                identity += capture.text(directory / name) + "\n"
        normalized = re.sub(r"[\\/\s]+", "/", identity)
        match = re.search(r"projects/system-bench/(soc|dma|udp|aes)(?:/|\b)", normalized)
        if not match:
            continue
        stage = "impl" if re.search(r"-(?:eda_)?vivado-", directory.name) else "negative" if re.search(r"negative|bad_reference", identity, re.I) else "sim"
        add(directory, match[1], stage)

    runs = []
    for attempt in attempts.values():
        directory = pathlib.Path(attempt["artifact_directory"])
        files = [p for p in directory.glob("*") if p.is_file() and (p.name in KEY_FILES or p.suffix == ".rpt")]
        for path in files:
            capture.read(path)
        logpath = directory / "process.log"
        log = capture.text(logpath)
        result = next((r["payload"] for r in attempt["result_records"] if r["payload"]), {})
        original_trace = capture.json(directory / "run.json") if (directory / "run.json").exists() else None
        command = capture.json(directory / "command.json") if (directory / "command.json").exists() else None
        source_manifest = capture.json(directory / "source-manifest.json") if (directory / "source-manifest.json").exists() else None
        if not result and original_trace and original_trace.get("status") == "failed":
            result = {"pass": False}
        build = capture.json(directory / "build-result.json") if attempt["stage"] == "impl" else {}
        build = build or {}
        timing = report_timing(capture.text(directory / "timing-summary.rpt")) if attempt["stage"] == "impl" else {}
        required = [logpath]
        if attempt["stage"] == "impl":
            required += [directory / n for n in ("build-result.json", "timing-summary.rpt", "utilization.rpt", "applied-constraints.xdc")]
        for path in required:
            capture.read(path)
        stable = all(capture.files[str(p)].get("status") == "captured" and not capture.files[str(p)].get("changed_during_read") for p in required)
        verdict = assess(attempt["project"], attempt["stage"], log, result, build, timing, stable)
        util = capture.text(directory / "utilization.rpt") if attempt["stage"] == "impl" else ""
        resources = {}
        for label in ("Slice LUTs", "Slice Registers", "RAMB36/FIFO*", "RAMB18", "DSPs"):
            match = re.search(r"^\|\s*" + re.escape(label) + r"\s*\|\s*([\d,]+)\s*\|", util, re.M)
            resources[label] = int(match[1].replace(",", "")) if match else None
        constraints = capture.text(directory / "applied-constraints.xdc") if attempt["stage"] == "impl" else ""
        checks = capture.text(directory / "check-timing.rpt") if attempt["stage"] == "impl" else ""
        route = capture.text(directory / "route-status.rpt") if attempt["stage"] == "impl" else ""
        case_markers = markers(log, r"^(?:SOC|DMA|UDP|AES)_(?:CASE_PASS|METRICS|GROUP_SENT|SUMMARY)\b")
        attempt.update(verdict=verdict, build_result=build, reported_timing=timing, resources=resources,
                       **ordering(capture, directory, original_trace, attempt["result_records"], command, log),
                       command_record={"path": str(directory / "command.json"), "payload": command} if command is not None else None,
                       source_manifest_record={"path": str(directory / "source-manifest.json"), "payload": source_manifest} if source_manifest is not None else None,
                       input_manifest=capture.json(directory / "inputs.json") if (directory / "inputs.json").exists() else None,
                       invoked_tcl=capture.text(directory / "invoked.tcl") if (directory / "invoked.tcl").exists() else None,
                       tool_commands=markers(log, r"^\[\d{4}-\d{2}-\d{2}T.+\]\s*\["),
                       original_trace_manifest=original_trace,
                       original_trace_snapshot_hashes_revalidated=False,
                       input_drift_reported=(original_trace or {}).get("input_drift"),
                       constraint_commands=[x for x in constraints.splitlines() if x.strip() and not x.lstrip().startswith("#")],
                       timing_checks={k: int(v) for k, v in re.findall(r"checking (\w+) \((\d+)\)", checks)},
                       route_summary=[x.strip() for x in route.splitlines() if "nets" in x],
                       case_and_metric_markers=case_markers, captured_evidence_paths=sorted(str(p) for p in files),
                       input_provenance="Collection hashes do not prove historical input bytes. Original trace claims, when available, are preserved separately and their snapshot hashes are not revalidated here.")
        runs.append(attempt)

    # Current source/fixture hashes are deliberately separate from historical attempts.
    current_inputs = []
    suffixes = {".v", ".sv", ".svh", ".c", ".S", ".ld", ".hex", ".mem", ".txt", ".py", ".tcl", ".json"}
    for project in PROJECTS:
        paths = set(p for p in (bench / project).glob("*") if p.is_file() and p.suffix in suffixes and not p.name.startswith("latest-"))
        manifest = capture.json(bench / project / "sources.json") or {}
        paths.update(capture.path(p) for p in manifest.get("sources", []))
        for path in sorted(paths):
            capture.read(path)
        current_inputs.append({"project": project, "paths": [str(p) for p in sorted(paths)], "scope": "current_files_at_collection_not_frozen_historical_inputs"})
    capture.read(bench / "implement-common.tcl")
    capture.read(pathlib.Path(__file__))
    summary = []
    for project in PROJECTS:
        for stage in ("sim", "impl", "negative"):
            candidates = sorted((r for r in runs if r["project"] == project and r["stage"] == stage), key=ordering_key)
            newest = candidates[-1] if candidates else None
            summary.append({"project": project, "stage": stage, "status": newest["verdict"]["status"] if newest else "missing",
                            "newest_retained_artifact": newest["artifact_directory"] if newest else None,
                            "ordering_timestamp_utc": newest["ordering_timestamp_utc"] if newest else None,
                            "ordering_basis": newest["ordering_basis"] if newest else None,
                            "ordering_source": newest["ordering_source"] if newest else None,
                            "retained_attempts": len(candidates)})
    return {"schema_version": 1, "collected_at_utc": utc(), "workspace": str(root),
            "collector": {"script": str(pathlib.Path(__file__).resolve()), "python": sys.version, "platform": platform.platform(),
                          "model_api_calls": 0, "codex_token_usage": None},
            "limitations": ["Collection hashes describe bytes read now; historical input freezing is not established.",
                            "A filesystem snapshot is not atomic. Files changing during a read are flagged; absent terminal evidence does not prove a live process.",
                            "Ordering prefers explicit recorded starts, then ISO log timestamps, ISO directory timestamps, and metadata-file mtime. Each choice records its basis; mtime is not a run start/end.",
                            "Only retained workspace artifacts are discoverable; deleted attempts cannot be reconstructed.",
                            "Large waveforms/checkpoints are not copied or hashed. Key logs/reports remain at their indexed original paths.",
                            "OOC setup/hold closure does not establish board timing or hardware operation."],
            "summary": summary, "latest_pointers": latest, "runs": sorted(runs, key=ordering_key),
            "unlinked_receipts": unlinked, "current_inputs": current_inputs, "files": list(capture.files.values())}


def render(data):
    lines = ["# System evidence snapshot", "", f"Captured UTC: {data['collected_at_utc']}", "",
             "| Project | Stage | Latest retained status | Retained attempts |", "|---|---|---|---:|"]
    for row in data["summary"]:
        lines.append(f"| {row['project']} | {row['stage']} | {row['status']} | {row['retained_attempts']} |")
    counts = collections.Counter(r["verdict"]["status"] for r in data["runs"])
    lines += ["", "Historical artifact outcomes: " + json.dumps(dict(counts)) + ".", "",
              f"Unlinked wrapper receipts: {len(data['unlinked_receipts'])}; inspect evidence.json before interpreting them as separate runs.", "",
              "Full paths, collection SHA-256, counters, error lines, timing, resources and constraints are in evidence.json.", "",
              "Collector model API calls: 0. Codex token usage is unavailable.", ""]
    lines += ["- " + item for item in data["limitations"]]
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.root.resolve()
    data = collect(root)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    out = root / "artifacts" / f"system-evidence-{stamp}-{uuid.uuid4().hex[:6]}"
    out.mkdir(parents=True)
    (out / "evidence.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (out / "summary.md").write_text(render(data), encoding="utf-8")
    print(json.dumps({"output": str(out), "summary": data["summary"], "model_api_calls": 0}, indent=2))


if __name__ == "__main__":
    main()
