"""Candidate admission, feature routing and budget/plateau control.

RouteAgents supplies the pure feature router. The local executor exposes a
version-bounded subset of moves. AER informs the gain-then-plateau stop rule.
No provider clients, credentials or network code belong in this module.
"""
from dataclasses import asdict
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
PLAYS = {
    'route_explore': {'family': 'route', 'base': 'best', 'commands': ['route_design -directive Explore'], 'reference': 'RouteAgents L11 / AER routing-only rounds'},
    'route_aggressive': {'family': 'route', 'base': 'best', 'commands': ['route_design -directive AggressiveExplore'], 'reference': 'RouteAgents D6 / AER routing-only rounds'},
    'route_more_global': {'family': 'route', 'base': 'best', 'commands': ['route_design -directive MoreGlobalIterations'], 'reference': 'RouteAgents L11 / AER routing-only rounds'},
    'rebuild_route': {'family': 'rebuild', 'base': 'best', 'commands': ['route_design -unroute', 'route_design -directive AggressiveExplore'], 'reference': 'RouteAgents D4 (local policy differs)'},
    'replace_explore': {'family': 'replace', 'base': 'baseline', 'commands': ['place_design -unplace', 'place_design -directive Explore', 'route_design -directive Explore'], 'reference': 'RouteAgents B1 / AER F-E'},
    'replace_timing': {'family': 'replace', 'base': 'baseline', 'commands': ['place_design -unplace', 'place_design -directive ExtraTimingOpt', 'route_design -directive Explore'], 'reference': 'AER F-D'},
    'replace_netdelay': {'family': 'replace', 'base': 'baseline', 'commands': ['place_design -unplace', 'place_design -directive ExtraNetDelay_high', 'route_design -directive Explore'], 'reference': 'AER F-N'},
}
TIMING_CHECKS = ('no_clock', 'unconstrained_internal_endpoints', 'no_input_delay', 'no_output_delay',
                 'partial_input_delay', 'partial_output_delay', 'multiple_clock', 'generated_clocks', 'loops', 'latch_loops')


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def atomic_json(path, data):
    path = Path(path)
    pending = path.with_suffix(path.suffix + '.pending')
    pending.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    pending.replace(path)


def fingerprint_text(text, comment_prefix):
    # Preserve command order, literals and internal whitespace. Conservative:
    # harmless serialization differences can reject a candidate, never bless it.
    lines = [line.rstrip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith(comment_prefix)]
    if not lines:
        raise ValueError('Empty fingerprint input')
    return hashlib.sha256('\n'.join(lines).encode('utf-8')).hexdigest()


def parse_reports(directory):
    directory = Path(directory)
    summary = (directory / 'timing.rpt').read_text(encoding='utf-8')
    fields = {}
    lines = summary.splitlines()
    for i, line in enumerate(lines):
        if line.strip().startswith('WNS(ns)') and 'WPWS(ns)' in line:
            data = lines[i + 2].split()
            if len(data) != 12:
                raise ValueError('Unrecognized design timing summary')
            for key, index in [('wns_ns', 0), ('tns_ns', 1), ('hold_ns', 4), ('pulse_width_ns', 8)]:
                fields[key] = float(data[index])
            fields['failing_endpoints'] = int(data[2])
            break
    route = (directory / 'route.rpt').read_text(encoding='utf-8')
    for key, label in [('routable', 'routable nets'), ('routed', 'fully routed nets'), ('route_errors', 'nets with routing errors')]:
        match = re.search(r'# of ' + label + r'\.+\s*:\s*(\d+)\s*:', route)
        fields[key] = int(match[1]) if match else None
    checks = {}
    for name, count in re.findall(r'checking\s+(\w+)\s+\((\d+)\)', (directory / 'check-timing.rpt').read_text(encoding='utf-8')):
        if name in checks and checks[name] != int(count):
            raise ValueError('Conflicting timing check counts')
        checks[name] = int(count)
    fields['timing_checks'] = checks
    fields['constraint_fingerprint'] = fingerprint_text((directory / 'timing.xdc').read_text(encoding='utf-8'), '#')
    fields['netlist_fingerprint'] = fingerprint_text((directory / 'netlist.v').read_text(encoding='utf-8'), '//')
    return fields


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def is_timeout_failure(text):
    return bool(re.search(r'\b(?:timed out|TimeoutError)\b|命令执行超时|等待响应超时', text, re.IGNORECASE))


def admissible(candidate, baseline):
    reasons = []
    for key in ('wns_ns', 'tns_ns', 'hold_ns', 'pulse_width_ns'):
        if not finite(candidate.get(key)):
            reasons.append(f'{key}: unavailable/nonfinite')
    for key in ('hold_ns', 'pulse_width_ns'):
        if finite(candidate.get(key)) and candidate[key] < 0:
            reasons.append(f'{key}: violation')
    if not isinstance(candidate.get('routable'), int) or candidate['routable'] <= 0 or candidate.get('routed') != candidate['routable'] or candidate.get('route_errors') != 0:
        reasons.append('routing: incomplete/unknown')
    if candidate.get('drc_errors') != 0 or candidate.get('drc_critical') != 0:
        reasons.append('DRC: errors/critical warnings/unknown')
    for key in TIMING_CHECKS:
        if candidate.get('timing_checks', {}).get(key) != 0:
            reasons.append(f'constraints: {key} not clean/known')
    for key in ('constraint_fingerprint', 'netlist_fingerprint', 'interface_fingerprint', 'part'):
        if not candidate.get(key) or not baseline.get(key) or candidate[key] != baseline[key]:
            reasons.append(f'{key}: changed/unavailable')
    return not reasons, reasons


def better(candidate, best, margin_ns):
    return candidate['wns_ns'] > best['wns_ns'] + margin_ns and candidate['tns_ns'] >= best['tns_ns'] - 1e-9


def upstream_router(features):
    path = ROOT / 'vendor/routeagents-fpl26/optimizer/recipe_router.py'
    provenance = json.loads((ROOT / '.eda/optimizer-upstreams.json').read_text(encoding='utf-8'))
    if digest(path) != provenance['runtime_import_sha256']:
        raise ValueError('Pinned RouteAgents router changed; review and repin explicitly')
    # Load this pure module only. Do not import the upstream agent/model runtime.
    module_name = '_eda_pinned_routeagents_router'
    if module_name not in sys.modules:
        spec = importlib.util.spec_from_file_location(module_name, path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
    module = sys.modules[module_name]
    clocks = features.get('clocks', [])
    phase = module.PhaseOneFeatures(wns_ns=features.get('wns_ns'),
        clock_period_ns=clocks[0]['period_ns'] if len(clocks) == 1 else None,
        failing_endpoint_count=features.get('failing_endpoints'), cell_count=features.get('cell_count'),
        remaining_wall_budget_s=features.get('remaining_seconds'))
    return asdict(module.decide_recipe_path(phase))


def make_plan(features, first_play=None):
    recommendation = upstream_router(features)
    wns = features.get('wns_ns')
    if not finite(wns):
        raise ValueError('Planning needs measured finite WNS')
    # Upstream tuned thresholds remain visible in recommendation, while this
    # local hardware policy avoids assuming 2025.1/RapidWright observations.
    if wns >= -0.5:
        order = ['route_explore', 'route_aggressive', 'route_more_global']
        reason = 'Timing met or near closure: preserve placement first.'
    elif features.get('lut_count', 0) >= 105000 or recommendation['rule_id'] in ('R3',):
        order = ['replace_explore', 'route_aggressive', 'replace_timing']
        reason = 'Measured size / upstream re-placement class selects pristine global placement.'
    else:
        order = ['route_aggressive', 'rebuild_route', 'replace_explore', 'replace_timing', 'replace_netdelay']
        reason = 'Incomplete spread/utilization features: bounded route-first local portfolio.'
    if first_play:
        if first_play not in PLAYS:
            raise ValueError('first_play must name a local catalog entry')
        order = [first_play] + [p for p in order if p != first_play]
    return {'upstream_recommendation': recommendation, 'local_reason': reason, 'ordered_plays': order,
            'first_choice_source': 'explicit current-agent/user selection' if first_play else 'deterministic measured-feature policy',
            'unavailable_features': ['critical-path spatial spread', 'resource utilization percentages'],
            'excluded_transforms': ['retiming', 'LUT rewriting', 'driver replication', 'pblock compaction'],
            'exclusion_reason': 'Require additional analysis and a functional-equivalence validator before enabling.',
            'model_api_calls': 0}


class StopPolicy:
    def __init__(self, max_trials, max_seconds, reserve_seconds=10):
        self.max_trials = max_trials
        self.max_seconds = max_seconds
        self.reserve_seconds = reserve_seconds
        self.completed = 0
        self.gained = False
        self.no_gain_streak = 0
        self.reason = None
        self.durations = {}

    def can_start(self, play, elapsed, cell_count):
        family = PLAYS[play]['family']
        estimate = self.durations.get(family)
        source = 'observed_family_duration_x1.25' if estimate is not None else 'local_cell_count_heuristic'
        if estimate is None:
            estimate = max(30, cell_count * (0.025 if family == 'replace' else 0.012))
        self.last_decision = {'play': play, 'estimated_seconds': estimate, 'estimate_source': source,
                              'remaining_seconds': max(0, self.max_seconds - elapsed),
                              'reserve_seconds': self.reserve_seconds, 'completed_trials': self.completed,
                              'max_trials': self.max_trials, 'allowed': False}
        if self.reason:
            self.last_decision['reason'] = self.reason
            return False
        if self.completed >= self.max_trials:
            self.reason = 'trial_budget'
            self.last_decision['reason'] = self.reason
            return False
        if elapsed + estimate + self.reserve_seconds >= self.max_seconds:
            self.reason = 'insufficient_time_for_next_move'
            self.last_decision['reason'] = self.reason
            return False
        self.last_decision.update(allowed=True, reason='within_budget')
        return True

    def observe(self, play, gained, duration):
        self.completed += 1
        self.durations[PLAYS[play]['family']] = max(1, duration * 1.25)
        self.no_gain_streak = 0 if gained else self.no_gain_streak + 1
        if self.gained and not gained:
            self.reason = 'aer_gain_then_plateau'
        elif self.no_gain_streak >= 2:
            self.reason = 'two_moves_without_gain'
        self.gained = self.gained or gained
