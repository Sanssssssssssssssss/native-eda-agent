"""Audit final receipts against raw logs, frozen RTL hashes and routed reports."""
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
OUT = ROOT / 'artifacts/hard-bench-assessment-20261023'
CONFIG = {
    'axi-fabric': ['latest-sim.json'],
    'ethernet-cdc': ['result-a.json', 'result-b.json'],
    'crypto-soc': ['latest-sim.json'],
}


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig')) if path.exists() else None


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def table_count(text, label):
    found = re.search(r'^\|\s*' + re.escape(label) + r'\s*\|\s*(\d+)\s*\|', text, re.M)
    return int(found[1]) if found else None


rows = []
for name, finals in CONFIG.items():
    directory = HERE / name
    sources = read(directory / 'sources.json')
    if not sources:
        continue
    current = {p: sha(ROOT / p) for p in sources['sources']}
    row = {'project': name, 'current_rtl_sha256': current, 'simulations': []}
    module_text = {}
    for path in current:
        text = (ROOT / path).read_text(encoding='utf-8')
        for m in re.finditer(r'(?ms)^\s*module\s+(\w+)\b.*?^\s*endmodule\b', text):
            module_text[m[1]] = m[0]
    active = set()
    for filename in finals:
        result = read(directory / filename)
        if not result or not result.get('artifact_directory'):
            row['simulations'].append({'receipt': filename, 'verified': False, 'reason': 'No completed receipt'})
            continue
        artifact = Path(result['artifact_directory'])
        log = (artifact / 'process.log').read_text(errors='replace')
        markers = re.findall(r'^HARD_BENCH_PASS[^\r\n]*', log, re.M)
        trace = read(artifact / 'run.json') or {}
        captured = {p['relative_path'].replace('\\', '/'): p['sha256'] for p in trace.get('inputs', [])
                    if p.get('relative_path') and p.get('sha256')}
        mismatch = []
        missing = []
        for path, digest in current.items():
            recorded = captured.get(path)
            if recorded is None and result.get('receipt_directory'):
                fallback = Path(result['receipt_directory']) / 'sources' / path
                if fallback.exists():
                    recorded = sha(fallback)
            if recorded is None:
                missing.append(path)
            elif recorded != digest:
                mismatch.append(path)
        passed = result.get('pass') and result.get('exit_code') == 0 and len(markers) == 1 and not re.search(r'Fatal:|FATAL:|ERROR:|Error:|TIMEOUT', log)
        for compiled in re.findall(r'Compiling module work\.(\w+)', log):
            # XSim names default parameter specializations <module>_default.
            active.add(compiled if compiled in module_text else compiled.removesuffix('_default'))
        row['simulations'].append({'receipt': filename, 'result': result, 'raw_log_pass': bool(passed),
            'markers': markers, 'counts': {k: int(v) for k, v in re.findall(r'(\w+)=(\d+)\b', ' '.join(markers))},
            'rtl_mismatch': mismatch, 'rtl_capture_missing': missing,
            'trace_drift': [{'path': p.get('relative_path'), 'role': p.get('role')} for p in trace.get('inputs', []) if p.get('drifted')],
            'verified': bool(passed and not mismatch and not missing)})
    active &= module_text.keys()
    row['elaborated_module_types'] = sorted(active)
    row['active_module_source_lines'] = sum(len(module_text[m].splitlines()) for m in active)
    row['functional_verified'] = len(row['simulations']) == len(finals) and all(s['verified'] for s in row['simulations'])
    negative_name = 'result-negative.json' if name == 'ethernet-cdc' else 'latest-negative.json'
    negative = read(directory / negative_name)
    row['negative_control'] = negative
    if negative and negative.get('artifact_directory'):
        log = (Path(negative['artifact_directory']) / 'process.log').read_text(errors='replace')
        row['negative_control_verified'] = bool(negative.get('pass') and 'Fatal:' in log and 'HARD_BENCH_PASS' not in log)
        row['negative_fatal'] = re.findall(r'^Fatal:[^\r\n]*', log, re.M)
    else:
        row['negative_control_verified'] = False
    impl = read(directory / 'latest-impl.json')
    row['implementation'] = impl
    if impl and impl.get('artifact_directory'):
        artifact = Path(impl['artifact_directory'])
        util = (artifact / 'utilization.rpt').read_text(errors='replace') if (artifact / 'utilization.rpt').exists() else ''
        row['physical_resources'] = {key: table_count(util, label) for key, label in
            [('slice_luts', 'Slice LUTs'), ('flip_flops', 'Slice Registers'), ('ramb36', 'RAMB36/FIFO*'), ('ramb18', 'RAMB18'), ('dsp48', 'DSPs')]}
        row['rtl_implementation_mismatch'] = [p for p, h in current.items() if (read(artifact / 'input-hashes.json') or {}).get(p) != h]
        row['implementation_verified'] = bool(impl.get('pass') and not row['rtl_implementation_mismatch'])
        check = (artifact / 'check-timing.rpt').read_text(errors='replace') if (artifact / 'check-timing.rpt').exists() else ''
        row['timing_checks'] = {k: int(v) for k, v in re.findall(r'checking (\w+) \((\d+)\)', check)}
        if (artifact / 'cdc.rpt').exists():
            cdc = (artifact / 'cdc.rpt').read_text(errors='replace')
            row['cdc_summary'] = [{'id': k, 'severity': sev, 'count': int(n)}
                                  for k, sev, n in re.findall(r'^(CDC-\d+)\s+(\w+)\s+(\d+)\s+', cdc, re.M)]
            row['cdc_review'] = read(directory / 'cdc-review.json')
    else:
        row['implementation_verified'] = False
    row['additional_warm_reset'] = read(directory / 'latest-warm.json') if name == 'crypto-soc' else None
    rows.append(row)

vendors = {}
for name in ['picorv32', 'verilog-axi', 'verilog-ethernet', 'aes']:
    path = ROOT / 'vendor' / name
    vendors[name] = {'commit': subprocess.check_output(['git', '-C', str(path), 'rev-parse', 'HEAD'], text=True).strip(),
                     'working_tree_clean': not subprocess.check_output(['git', '-C', str(path), 'status', '--porcelain'], text=True).strip()}
result = {'collected_at_utc': dt.datetime.now(dt.timezone.utc).isoformat(), 'projects': rows, 'upstreams': vendors,
          'totals': {'projects': len(rows), 'functional_pass': sum(r['functional_verified'] for r in rows),
                     'negative_control_pass': sum(r['negative_control_verified'] for r in rows),
                     'implementation_pass': sum(r['implementation_verified'] for r in rows)},
          'scope': 'Visible-test integration and repair exercise; not blind benchmark or pass@1; no board execution.',
          'line_count_definition': 'Text lines within unique module definitions actually elaborated, including comments, ports and inactive parameter branches; not all authored by Codex.',
          'other_model_api_calls': 0}
OUT.mkdir(exist_ok=True)
(OUT / 'results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps({'totals': result['totals'], 'projects': [{'project': r['project'], 'functional': r['functional_verified'],
    'negative': r['negative_control_verified'], 'implementation': r['implementation_verified'],
    'modules': len(r['elaborated_module_types']), 'lines': r['active_module_source_lines']} for r in rows]}, indent=2))
