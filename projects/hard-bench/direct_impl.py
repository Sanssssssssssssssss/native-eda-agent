"""Run one hard-bench implementation, retaining input hashes and failed attempts."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('project', choices=['axi-fabric', 'ethernet-cdc', 'crypto-soc'])
    ap.add_argument('--timeout', type=int, default=900)
    args = ap.parse_args()
    project = HERE / args.project
    spec = json.loads((project / 'sources.json').read_text(encoding='utf-8'))
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    out = ROOT / 'artifacts' / f'hard-{args.project}-impl-{stamp}-{uuid.uuid4().hex[:6]}'
    out.mkdir(parents=True)
    inputs = set((ROOT / source).resolve() for source in spec['sources'])
    implementation_inputs = set(inputs) | {project / 'sources.json'}
    inputs.update(p for p in project.rglob('*') if p.is_file() and (p.suffix in
                  {'.v', '.sv', '.vh', '.svh', '.tcl', '.hex', '.mem', '.c', '.h', '.S', '.ld', '.py'}
                  or p.name in {'sources.json', 'sim.json', 'impl.json', 'manifest.json'}))
    inputs.update([Path(__file__), ROOT / 'projects/system-bench/implement-common.tcl'])
    # Include explicit workspace Tcl dependencies, including upstream CDC constraints.
    scanned = set()
    while True:
        pending = [p for p in inputs if p.suffix == '.tcl' and p not in scanned]
        if not pending:
            break
        for script in pending:
            scanned.add(script)
            for relative in re.findall(r'source\s+\[file join \$root ([^\]]+)\]', script.read_text()):
                inputs.add((ROOT / Path(*relative.split())).resolve())
    implementation_inputs.update(p for p in inputs if p.suffix in {'.tcl', '.hex', '.mem'})
    hashes = {}
    for source in sorted(inputs):
        relative = source.relative_to(ROOT)
        target = out / 'inputs' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        hashes[relative.as_posix()] = sha(source)
    (out / 'input-hashes.json').write_text(json.dumps(hashes, indent=2))
    cmd = ['E:/Xilinx/Vivado/2020.2/bin/vivado.bat', '-mode', 'batch', '-notrace',
           '-source', str(project / 'implement.tcl'), '-log', 'vivado.log', '-journal', 'vivado.jou']
    env = os.environ.copy()
    env['EDA_WORKSPACE'] = str(ROOT)
    (out / 'command.json').write_text(json.dumps({'argv': cmd, 'cwd': str(out),
        'input_policy': 'Copies and hashes captured before launch; executes original workspace paths; rejects source drift.'}, indent=2))
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    start = time.monotonic()
    timeout = False
    with (out / 'process.log').open('w', encoding='utf-8') as log:
        p = subprocess.Popen(cmd, cwd=out, env=env, stdin=subprocess.DEVNULL,
                             stdout=log, stderr=subprocess.STDOUT)
        print(f'IMPLEMENTATION_STARTED project={args.project} pid={p.pid} directory={out}', flush=True)
        try:
            p.wait(timeout=args.timeout)
        except subprocess.TimeoutExpired:
            timeout = True
            subprocess.run(['taskkill.exe', '/PID', str(p.pid), '/T', '/F'], capture_output=True)
            p.wait()
    build_path = out / 'build-result.json'
    build = json.loads(build_path.read_text()) if build_path.exists() else {}
    all_drift = [name for name, digest in hashes.items() if not (ROOT / name).is_file() or sha(ROOT / name) != digest]
    drift = [name for name in all_drift if (ROOT / name) in implementation_inputs]
    route_path = out / 'route-status.rpt'
    route_text = route_path.read_text(errors='replace') if route_path.exists() else ''
    route = {}
    for name, label in [('routable', 'routable nets'), ('fully_routed', 'fully routed nets'), ('errors', 'nets with routing errors')]:
        match = re.search(r'# of ' + label + r'\.+\s*:\s*(\d+)', route_text)
        route[name] = int(match[1]) if match else None
    routed = route['routable'] is not None and route['fully_routed'] == route['routable'] and route['errors'] == 0
    timing = build.get('setup_slack_ns', -1) >= 0 and build.get('hold_slack_ns', -1) >= 0
    passed = p.returncode == 0 and not timeout and not drift and build.get('stage') == 'routed' and routed and timing
    result = {'project': args.project, 'stage': 'impl', 'pass': passed, 'exit_code': p.returncode,
              'started_at_utc': started, 'wall_seconds': round(time.monotonic() - start, 2),
              'artifact_directory': str(out), 'timeout': timeout, 'source_drift': drift,
              'auxiliary_source_drift': [name for name in all_drift if name not in drift],
              'routing_verified': routed, 'timing_verified': timing, 'routing': route,
              'build': build, 'other_model_api_calls': 0}
    (out / 'result.json').write_text(json.dumps(result, indent=2))
    (project / 'latest-impl.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2), flush=True)
    raise SystemExit(0 if passed else 1)


if __name__ == '__main__':
    main()
