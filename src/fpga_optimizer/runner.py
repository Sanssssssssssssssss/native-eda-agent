"""Measured candidate loop with immutable inputs and an atomic best pointer."""
import asyncio
import json
from pathlib import Path
import shutil
import time

from .core import ROOT, PLAYS, StopPolicy, admissible, atomic_json, better, digest, make_plan
from .trace import OptimizerTrace
from .recovery import code_hashes, commit_recovery, verify_recovery


def validate_request(request):
    allowed = {'checkpoint', 'mode', 'max_trials', 'max_seconds', 'min_gain_ns', 'first_play'}
    if not isinstance(request, dict) or set(request) - allowed:
        raise ValueError('Unexpected request fields')
    checkpoint = (ROOT / request['checkpoint']).resolve(strict=True)
    if not checkpoint.is_relative_to(ROOT) or checkpoint.suffix.lower() != '.dcp' or not checkpoint.is_file():
        raise ValueError('checkpoint must be a .dcp inside this workspace')
    values = {'checkpoint': str(checkpoint), 'mode': 'plan', 'max_trials': 3, 'max_seconds': 600, 'min_gain_ns': 0.01, **request}
    values['checkpoint'] = str(checkpoint)
    if values['mode'] not in ('plan', 'run'):
        raise ValueError('mode must be plan or run')
    for key, lo, hi in [('max_trials', 1, 7), ('max_seconds', 60, 3600)]:
        if type(values[key]) is not int or not lo <= values[key] <= hi:
            raise ValueError(f'Invalid {key}')
    if type(values['min_gain_ns']) not in (int, float) or not 0.001 <= values['min_gain_ns'] <= 1:
        raise ValueError('min_gain_ns must be 0.001..1 ns')
    if values.get('first_play') and values['first_play'] not in PLAYS:
        raise ValueError('Unknown first_play')
    return values


async def optimize(request, output, backend_factory, clock=time.monotonic, trace_context=None, recovery=None):
    request = validate_request(request)
    restored = verify_recovery(recovery) if recovery else None
    if restored and (request['mode'] != 'run' or request['min_gain_ns'] != restored['request']['min_gain_ns'] or request.get('first_play')):
        raise ValueError('Recovery requires run mode and the original threshold/plan')
    hashes = code_hashes()
    output = Path(output).resolve()
    if not output.is_relative_to(ROOT):
        raise ValueError('Output must stay within the workspace')
    output.mkdir(exist_ok=False)
    trace = OptimizerTrace(output, trace_context)
    trace.event('optimizer_start')
    start = clock()
    original = Path(request['checkpoint'])
    original_hash = digest(original)
    result = {'schema_version': 1, 'status': 'running', 'request': request, 'model_api_calls': 0,
              'model_client_loaded': False, 'output_directory': str(output), 'attempts': [],
              'input_sha256': original_hash, 'functional_equivalence': 'not_evaluated', 'board_signoff': False,
              'acceptance_scope': 'Conservative matching funcsim representation + timing constraints + fully routed timing/DRC; no formal or simulation proof.'}
    result['trace'] = trace.metadata()
    if restored:
        result['recovery'] = {'source_directory': recovery['source_directory'], 'source_trace': restored['trace'],
                              'journal_sha256': recovery['journal_sha256'], 'inherited_candidates': len(restored['completed_attempts'])}
        trace.event('recovery_from', source_trace_id=restored['trace']['trace_id'], source_span_id=restored['trace']['span_id'])
    result['provenance'] = json.loads((ROOT / '.eda/optimizer-upstreams.json').read_text(encoding='utf-8'))
    best = None
    best_path = None
    best_hash = None

    def save():
        result['elapsed_seconds'] = round(clock() - start, 3)
        atomic_json(output / 'optimizer-result.json', result)

    def bank(metrics, checkpoint, label):
        nonlocal best, best_path, best_hash
        checksum = digest(checkpoint)
        if label.startswith('baseline') and checksum != original_hash:
            raise RuntimeError('Baseline DCP drifted before banking or rollback')
        # DCPs stay in immutable per-attempt directories. Only this pointer moves.
        pointer = {'label': label, 'checkpoint': str(checkpoint), 'sha256': checksum, 'metrics': metrics}
        atomic_json(output / 'best.json', pointer)
        trace.event('best_updated', previous_label=result.get('best', {}).get('label'), label=label,
                    checkpoint=str(checkpoint), sha256=checksum, wns_ns=metrics['wns_ns'], tns_ns=metrics['tns_ns'])
        trace.evidence(checkpoint, 'banked_checkpoint')
        best, best_path, best_hash = metrics, Path(checkpoint), checksum
        result['best'] = pointer

    save()
    try:
        base_dir = output / 'baseline'
        base_dir.mkdir()
        baseline_dcp = base_dir / 'input.dcp'
        shutil.copy2(original, baseline_dcp)
        if digest(baseline_dcp) != original_hash:
            raise RuntimeError('Input snapshot hash mismatch')
        trace.evidence(baseline_dcp, 'baseline_checkpoint')
        instance = backend_factory(output)
        instance.trace = trace
        async with instance as backend:
            with trace.span('baseline_measurement'):
                baseline, _ = await backend.measure(baseline_dcp, base_dir, timeout=min(180, request['max_seconds']))
            atomic_json(base_dir / 'measurement.json', baseline)
            trace.evidence(base_dir / 'measurement.json', 'measurement')
            result['baseline'] = baseline
            valid, reasons = admissible(baseline, baseline)
            result['baseline_admission'] = {'passed': valid, 'reasons': reasons}
            trace.event('baseline_admission', **result['baseline_admission'])
            if not valid:
                result.update(status='blocked_by_baseline', stop_reason='Baseline failed required measurement/constraint checks')
                return result
            bank(baseline, baseline_dcp, 'baseline')
            features = {**baseline, 'remaining_seconds': max(0, request['max_seconds'] - (clock() - start))}
            plan = restored['plan'] if restored else make_plan(features, request.get('first_play'))
            if restored:
                old_base = restored['baseline']['metrics']
                if not admissible(baseline, old_base)[0] or abs(baseline['wns_ns'] - old_base['wns_ns']) > 0.001 or abs(baseline['tns_ns'] - old_base['tns_ns']) > 0.001:
                    raise RuntimeError('Recovery baseline does not reproduce committed measurements')
                recovered_dir = output / 'recovered-best'
                recovered_dir.mkdir()
                recovered_dcp = recovered_dir / 'input.dcp'
                shutil.copy2(restored['best']['checkpoint'], recovered_dcp)
                if digest(recovered_dcp) != restored['best']['sha256']:
                    raise RuntimeError('Recovery checkpoint changed during copy')
                with trace.span('recovery_recheck'):
                    metrics, _ = await backend.measure(recovered_dcp, recovered_dir,
                        timeout=max(1, request['max_seconds'] - (clock() - start) - 10))
                if digest(recovered_dcp) != restored['best']['sha256']:
                    raise RuntimeError('Recovered DCP changed during remeasurement')
                expected = restored['best']['metrics']
                atomic_json(recovered_dir / 'measurement.json', metrics)
                trace.evidence(recovered_dir / 'measurement.json', 'recovery_measurement')
                accepted, reasons = admissible(metrics, baseline)
                if abs(metrics['wns_ns'] - expected['wns_ns']) > 0.001 or abs(metrics['tns_ns'] - expected['tns_ns']) > 0.001:
                    accepted = False
                    reasons.append('Recovery WNS/TNS differs from committed measurements')
                trace.event('recovery_validation', passed=accepted, reasons=reasons)
                if not accepted:
                    raise RuntimeError('Recovery best checkpoint failed independent remeasurement')
                bank(metrics, recovered_dcp, 'recovered_best')
            result['plan'] = plan
            atomic_json(output / 'plan.json', plan)
            trace.evidence(output / 'plan.json', 'plan')
            trace.event('plan_selected', ordered_plays=plan['ordered_plays'], reason=plan['local_reason'],
                        first_choice_source=plan['first_choice_source'], unavailable_features=plan['unavailable_features'])
            inherited = restored['completed_attempts'] if restored else []
            def commit():
                commit_recovery(output, trace, request, baseline, baseline_dcp, result['best'], plan, result['attempts'], hashes, inherited,
                                engine_pid=getattr(backend, 'engine_pid', None))
            commit()
            if request['mode'] == 'plan':
                result.update(status='planned', stop_reason='plan_only')
                return result
            policy = StopPolicy(request['max_trials'], request['max_seconds'])
            for old in inherited:
                policy.observe(old['play'], old['accepted'], old['duration_seconds'])
            policy.completed = 0  # The new segment has its own explicit trial/time allowance.
            finished_plays = {a['play'] for a in inherited}
            for index, play in enumerate(plan['ordered_plays'], 1):
                if play in finished_plays:
                    continue
                allowed = policy.can_start(play, clock() - start, baseline['cell_count'])
                trace.event('budget_decision', **policy.last_decision)
                if not allowed:
                    break
                if digest(best_path) != best_hash:
                    raise RuntimeError('Banked DCP drifted before reuse')
                if digest(baseline_dcp) != original_hash:
                    raise RuntimeError('Baseline DCP drifted before reuse')
                directory = output / f'{index:02d}-{play}'
                directory.mkdir()
                source = baseline_dcp if PLAYS[play]['base'] == 'baseline' else best_path
                candidate_input = directory / 'input.dcp'
                shutil.copy2(source, candidate_input)
                attempt = {'candidate_id': f'{index:02d}-{play}', 'status': 'running',
                           'play': play, 'source': str(source), 'input_sha256': digest(candidate_input),
                           'reference': PLAYS[play]['reference'], 'directory': str(directory), 'accepted': False}
                result['attempts'].append(attempt)
                save()
                attempt_start = clock()
                print(json.dumps({'stage': 'candidate', 'index': index, 'play': play}), flush=True)
                try:
                    with trace.span('candidate', candidate_id=attempt['candidate_id'], play=play):
                        trace.evidence(candidate_input, 'candidate_input')
                        metrics, candidate_path = await backend.measure(candidate_input, directory, play,
                            timeout=max(1, request['max_seconds'] - (clock() - start) - 10))
                        atomic_json(directory / 'measurement.json', metrics)
                        trace.evidence(directory / 'measurement.json', 'measurement')
                        valid, reasons = admissible(metrics, baseline)
                        attempt.update(metrics=metrics, admission={'passed': valid, 'reasons': reasons})
                        trace.event('candidate_admission', candidate_id=attempt['candidate_id'], passed=valid, reasons=reasons,
                                    wns_ns=metrics.get('wns_ns'), tns_ns=metrics.get('tns_ns'),
                                    reference_wns_ns=best['wns_ns'], min_gain_ns=request['min_gain_ns'])
                        if valid and better(metrics, best, request['min_gain_ns']):
                            bank(metrics, candidate_path, play)
                            attempt['accepted'] = True
                        elif valid:
                            attempt['rejection'] = 'No sufficient WNS gain or TNS regressed'
                        else:
                            attempt['rejection'] = 'Admission failed'
                        attempt['status'] = 'accepted' if attempt['accepted'] else 'rejected'
                except asyncio.CancelledError:
                    attempt['status'] = 'cancelled'
                    raise
                except Exception as exc:
                    attempt['error'] = f'{type(exc).__name__}: {exc}'
                    attempt['status'] = 'failed'
                finally:
                    attempt['duration_seconds'] = round(clock() - attempt_start, 3)
                    atomic_json(directory / 'candidate.json', attempt)
                    trace.evidence(directory / 'candidate.json', 'candidate_result')
                    trace.event('candidate_end', candidate_id=attempt['candidate_id'], status=attempt['status'],
                                accepted=attempt['accepted'], error_type=attempt.get('error', '').split(':')[0] or None)
                    save()
                policy.observe(play, attempt['accepted'], clock() - attempt_start)
                commit()
                if backend.timed_out:
                    policy.reason = 'tool_timeout'
                    break
            result['stop_reason'] = policy.reason or 'portfolio_exhausted'
            trace.event('search_stopped', reason=result['stop_reason'])
            # Re-open and remeasure winner before reporting it, within remaining budget.
            remaining = request['max_seconds'] - (clock() - start)
            if not backend.timed_out and remaining > 10:
                final_dir = output / 'recheck'
                try:
                    with trace.span('winner_recheck', checkpoint=str(best_path)):
                        if digest(best_path) != best_hash:
                            raise RuntimeError('Banked DCP drifted before final remeasurement')
                        final_metrics, _ = await backend.measure(best_path, final_dir, timeout=max(1, remaining - 5))
                        if digest(best_path) != best_hash:
                            raise RuntimeError('Banked DCP drifted during final remeasurement')
                    valid, reasons = admissible(final_metrics, baseline)
                    stable = valid and abs(final_metrics['wns_ns'] - best['wns_ns']) <= 0.001 and final_metrics['tns_ns'] >= best['tns_ns'] - 0.001
                    atomic_json(final_dir / 'measurement.json', final_metrics)
                    trace.evidence(final_dir / 'measurement.json', 'measurement')
                    if valid and not stable:
                        reasons.append('Remeasured WNS/TNS differs from banked metrics')
                except Exception as exc:
                    stable, reasons = False, [f'Remeasurement failed: {exc}']
                result['winner_recheck'] = {'passed': stable, 'reasons': reasons}
                trace.event('winner_validation', **result['winner_recheck'])
                if not stable:
                    bank(baseline, baseline_dcp, 'baseline_after_failed_recheck')
                    result['stop_reason'] = 'winner_recheck_failed'
            else:
                result['winner_recheck'] = {'passed': False, 'reasons': ['No time/session for independent remeasurement']}
                trace.event('winner_validation', **result['winner_recheck'])
                bank(baseline, baseline_dcp, 'baseline_without_winner_recheck')
            result['status'] = 'completed'
            result['attempts_with_errors'] = sum('error' in attempt for attempt in result['attempts'])
            result['accepted_attempts'] = sum(attempt['accepted'] for attempt in result['attempts'])
            result['wns_gain_ns'] = round(best['wns_ns'] - baseline['wns_ns'], 6)
            result['timing_closed'] = best['wns_ns'] >= 0 and best['tns_ns'] >= 0
            commit()
            return result
    except BaseException as exc:
        result.update(status='cancelled' if isinstance(exc, asyncio.CancelledError) else 'failed', error=f'{type(exc).__name__}: {exc}')
        raise
    finally:
        try:
            result['input_unchanged'] = digest(original) == original_hash
        except OSError:
            result['input_unchanged'] = False
        if not result['input_unchanged']:
            result['status'] = 'failed'
            result['error'] = 'Original input changed during run'
        if result['status'] == 'completed':
            if not result['winner_recheck']['passed']:
                outcome, action = 'unverified_winner', 'Inspect recheck evidence; retain the baseline and start a fresh run only after diagnosis.'
            elif result['attempts'] and result['attempts_with_errors'] == len(result['attempts']):
                outcome, action = 'candidate_errors', 'Inspect failed candidate and MCP spans before retrying.'
            elif result['wns_gain_ns'] > 0:
                outcome, action = 'improved', 'Review functional acceptance separately before using the selected checkpoint.'
            elif not result['attempts']:
                outcome, action = ('revalidated', 'Recovered state was remeasured; no additional candidate was needed.') if restored else ('budget_exhausted', 'Review recorded budget estimate and choose a suitable run budget.')
            elif all(not a.get('admission', {}).get('passed') for a in result['attempts']):
                outcome, action = 'candidate_rejected', 'Inspect admission reasons; preserve constraints and acceptance checks.'
            else:
                outcome, action = 'no_gain', 'Keep the baseline; inspect the plan and measurements before changing strategy.'
        else:
            outcome = result['status']
            action = {'planned': 'Review plan.json. Plan mode measured the baseline but tried no candidates.',
                      'blocked_by_baseline': 'Fix missing or invalid baseline evidence before optimizing.',
                      'cancelled': 'Inspect runtime ownership and trace; a new run is required.',
                      'failed': 'Inspect failure and runtime ownership before retrying in a new directory.'}.get(outcome, 'Inspect evidence.')
        result.update(outcome=outcome, next_action=action)
        trace.event('optimizer_end', status=result['status'], outcome=outcome,
                    input_unchanged=result['input_unchanged'], stop_reason=result.get('stop_reason'),
                    model_api_calls=0)
        save()
