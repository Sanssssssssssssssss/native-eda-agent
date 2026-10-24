"""Durable candidate boundaries. Recovery always starts a new owned run."""
from pathlib import Path
import json
import os
from .core import ROOT, digest, atomic_json

SOURCES = ['src/fpga_optimizer/core.py', 'src/fpga_optimizer/runner.py', 'src/fpga_optimizer/backend.py',
           'src/fpga_optimizer/trace.py', 'src/fpga_optimizer/recovery.py', 'src/tools/vivado-common.tcl',
           'src/vivado_workbench.py', '.eda/optimizer-upstreams.json', 'vendor/routeagents-fpl26/optimizer/recipe_router.py']


def code_hashes():
    return {name: digest(ROOT / name) for name in SOURCES}


def verify_recovery(recovery):
    source = Path(recovery['source_directory']).resolve(strict=True)
    if not source.is_relative_to(ROOT / 'artifacts'):
        raise ValueError('Recovery must use workspace artifacts')
    if digest(source / 'recovery.json') != recovery['journal_sha256']:
        raise ValueError('Recovery journal changed after preflight')
    journal = recovery['journal']
    if journal != json.loads((source / 'recovery.json').read_text(encoding='utf-8')):
        raise ValueError('Recovery payload does not match the committed journal')
    if journal['code_hashes'] != code_hashes():
        raise ValueError('Recovery implementation differs from committed checkpoint')
    for pointer in [journal['baseline'], journal['best']]:
        file = Path(pointer['checkpoint']).resolve(strict=True)
        if not file.is_relative_to(source) or digest(file) != pointer['sha256']:
            raise ValueError('Recovery checkpoint missing, escaped or modified')
    return journal


def commit_recovery(output, trace, request, baseline, baseline_path, best, plan, attempts, hashes, inherited=None, engine_pid=None):
    history = [*(inherited or []), *[a for a in attempts if a['status'] in ('accepted', 'rejected', 'failed')]]
    journal = {'schema_version': 1, 'trace': trace.metadata(), 'committed_event_seq': trace.seq,
               'owner': {'python_pid': os.getpid(), 'engine_pid': engine_pid},
               'request': request, 'code_hashes': hashes,
               'baseline': {'checkpoint': str(baseline_path), 'sha256': digest(baseline_path), 'metrics': baseline},
               'best': best, 'plan': plan, 'completed_attempts': history}
    history_dir = Path(output) / 'recovery'
    history_dir.mkdir(exist_ok=True)
    version = history_dir / f'{trace.seq + 1:06d}.json'
    atomic_json(version, journal)
    trace.event('recovery_checkpoint', completed_candidates=len(history), journal_sha256=digest(version),
                journal_file=version.relative_to(output).as_posix())
    # Publish the pointer last; an interruption keeps the previous valid boundary.
    atomic_json(Path(output) / 'recovery.json', journal)
