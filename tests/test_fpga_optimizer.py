"""Adversarial admission and complete loop tests. Synthetic results are explicit."""
import asyncio
import copy
import json
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from fpga_optimizer.core import TIMING_CHECKS, admissible, better, fingerprint_text, make_plan, StopPolicy, is_timeout_failure
from fpga_optimizer.runner import optimize, validate_request


def measured(**overrides):
    return {'wns_ns': 0.2, 'tns_ns': 0.0, 'hold_ns': 0.05, 'pulse_width_ns': 1.0,
            'routable': 100, 'routed': 100, 'route_errors': 0, 'drc_errors': 0, 'drc_critical': 0,
            'timing_checks': dict.fromkeys(TIMING_CHECKS, 0), 'constraint_fingerprint': 'timing-A',
            'netlist_fingerprint': 'netlist-A', 'interface_fingerprint': 'ports-A', 'part': 'test-part',
            'clocks': [{'name': 'clk', 'period_ns': 10}], 'cell_count': 1000, 'lut_count': 200,
            'failing_endpoints': 0, **overrides}


class AdmissionTests(unittest.TestCase):
    def test_finite_complete_baseline(self):
        self.assertEqual(admissible(measured(), measured()), (True, []))

    def test_optimistic_but_invalid_candidates(self):
        cases = [dict(hold_ns=-0.01), dict(pulse_width_ns=-0.1), dict(routed=99), dict(route_errors=1),
                 dict(wns_ns=float('nan')), dict(tns_ns=float('inf')), dict(drc_errors=1), dict(drc_critical=None),
                 dict(constraint_fingerprint='relaxed-clock'), dict(netlist_fingerprint='changed-logic'),
                 dict(interface_fingerprint='missing-port'), dict(part='other-device'), dict(timing_checks={})]
        for bad in cases:
            with self.subTest(bad=bad):
                self.assertFalse(admissible(measured(wns_ns=1.0) | bad, measured())[0])

    def test_missing_fingerprint_is_not_equal_evidence(self):
        self.assertFalse(admissible(measured(constraint_fingerprint=None), measured(constraint_fingerprint=None))[0])

    def test_wns_gain_cannot_hide_tns_regression(self):
        self.assertFalse(better(measured(wns_ns=1, tns_ns=-2), measured(), 0.01))
        self.assertFalse(better(measured(wns_ns=0.205), measured(), 0.01))

    def test_constraint_digest_retains_io_delays_and_command_order(self):
        a = '# date A\ncreate_clock -period 10 [get_ports clk]\nset_input_delay 2 [get_ports a]\n'
        self.assertEqual(fingerprint_text(a, '#'), fingerprint_text(a.replace('date A', 'date B'), '#'))
        self.assertNotEqual(fingerprint_text(a, '#'), fingerprint_text(a.replace('delay 2', 'delay 0'), '#'))
        with self.assertRaises(ValueError):
            fingerprint_text('# only comments', '#')

    def test_positive_slack_does_not_trigger_destructive_plan(self):
        plan = make_plan(measured(wns_ns=9.0))
        self.assertTrue(all(name.startswith('route_') for name in plan['ordered_plays']))
        self.assertEqual(plan['model_api_calls'], 0)

    def test_explicit_first_choice_is_bounded(self):
        self.assertEqual(make_plan(measured(), 'replace_timing')['ordered_plays'][0], 'replace_timing')
        with self.assertRaises(ValueError):
            make_plan(measured(), 'set_false_path')

    def test_aer_gain_then_plateau(self):
        policy = StopPolicy(7, 600)
        policy.observe('route_explore', True, 20)
        policy.observe('route_aggressive', False, 15)
        self.assertEqual(policy.reason, 'aer_gain_then_plateau')
        self.assertFalse(policy.can_start('replace_timing', 40, 1000))

    def test_no_gain_and_budget_stop(self):
        policy = StopPolicy(7, 600)
        policy.observe('route_explore', False, 1)
        policy.observe('route_aggressive', False, 1)
        self.assertEqual(policy.reason, 'two_moves_without_gain')
        policy = StopPolicy(7, 60)
        self.assertFalse(policy.can_start('replace_timing', 1, 100000))

    def test_timeout_field_validation_error_does_not_kill_engine(self):
        self.assertFalse(is_timeout_failure('run_tclArguments timeout Input should be a valid integer'))
        self.assertTrue(is_timeout_failure('命令执行超时（60s），Vivado 可能仍在执行'))


class FakeBackend:
    timed_out = False
    def __init__(self, candidates, final=None):
        self.candidates = iter(candidates)
        self.final = final
        self.current = measured()
        self.calls = []
    async def __aenter__(self): return self
    async def __aexit__(self, *args): return None
    async def measure(self, checkpoint, directory, play=None, timeout=180):
        directory = Path(directory)
        directory.mkdir(exist_ok=True)
        self.calls.append((play, str(checkpoint)))
        if play:
            item = next(self.candidates)
            if isinstance(item, Exception): raise item
            self.current = item
            path = directory / 'design.dcp'
            path.write_bytes(f'SYNTHETIC_DCP:{item["wns_ns"]}'.encode())
            return copy.deepcopy(item), path
        if directory.name == 'recheck':
            if isinstance(self.final, Exception): raise self.final
            return copy.deepcopy(self.final or self.current), Path(checkpoint)
        return measured(), Path(checkpoint)


class LoopTests(unittest.TestCase):
    def run_loop(self, backend, **options):
        with tempfile.TemporaryDirectory(dir=ROOT / 'artifacts', prefix='optimizer-unit-') as temp:
            source = Path(temp) / 'input.dcp'
            source.write_bytes(b'SYNTHETIC_BASELINE_DCP')
            request = {'checkpoint': str(source), 'mode': 'run', **options}
            # Any attempted socket connection from the orchestrator is an error.
            async def isolated_run():
                # Windows creates a loopback socketpair when the event loop
                # starts. Block connections only after that local setup.
                with patch('socket.socket.connect', side_effect=AssertionError('network forbidden')):
                    return await optimize(request, Path(temp) / 'result', lambda _: backend)
            result = asyncio.run(isolated_run())
            self.events = [json.loads(line) for line in (Path(temp) / 'result/optimizer-events.jsonl').read_text(encoding='utf-8').splitlines()]
            self.assertEqual([e['seq'] for e in self.events], list(range(1, len(self.events) + 1)))
            self.assertEqual(self.events[-1]['type'], 'optimizer_end')
            self.assertEqual(self.events[-1]['outcome'], result['outcome'])
            pointer = json.loads((Path(temp) / 'result/best.json').read_text())
            self.assertEqual(source.read_bytes(), b'SYNTHETIC_BASELINE_DCP')
            return result, pointer

    def test_gain_then_loss_keeps_winner_and_stops(self):
        winner = measured(wns_ns=0.4)
        backend = FakeBackend([winner, measured(wns_ns=0.1)], final=winner)
        result, pointer = self.run_loop(backend)
        self.assertEqual(len(result['attempts']), 2)
        self.assertEqual(pointer['metrics']['wns_ns'], 0.4)
        self.assertEqual(result['stop_reason'], 'aer_gain_then_plateau')

    def test_failed_move_and_fake_improvement_keep_baseline(self):
        backend = FakeBackend([RuntimeError('tool failed'), measured(wns_ns=5, constraint_fingerprint='relaxed')], final=measured())
        result, pointer = self.run_loop(backend)
        self.assertEqual(pointer['label'], 'baseline')
        self.assertEqual(result['attempts_with_errors'], 1)
        self.assertEqual(result['accepted_attempts'], 0)

    def test_final_measurement_failure_falls_back(self):
        backend = FakeBackend([measured(wns_ns=0.4)], final=RuntimeError('stale result'))
        result, pointer = self.run_loop(backend, max_trials=1)
        self.assertIn('baseline', pointer['label'])
        self.assertFalse(result['winner_recheck']['passed'])

    def test_final_metric_regression_falls_back(self):
        backend = FakeBackend([measured(wns_ns=0.4)], final=measured(wns_ns=0.39))
        result, pointer = self.run_loop(backend, max_trials=1)
        self.assertIn('baseline', pointer['label'])
        self.assertEqual(result['wns_gain_ns'], 0)

    def test_plan_never_executes_a_candidate(self):
        backend = FakeBackend([])
        result, _ = self.run_loop(backend, mode='plan')
        self.assertEqual(result['status'], 'planned')
        self.assertEqual(len(backend.calls), 1)

    def test_model_runtime_never_imported(self):
        self.run_loop(FakeBackend([]), mode='plan')
        self.assertNotIn('openai', sys.modules)
        self.assertNotIn('dcp_optimizer', sys.modules)

    def test_all_candidate_errors_are_not_no_gain(self):
        result, _ = self.run_loop(FakeBackend([RuntimeError('failed A'), RuntimeError('failed B')], final=measured()))
        self.assertEqual(result['outcome'], 'candidate_errors')
        self.assertEqual(result['attempts_with_errors'], 2)
        self.assertEqual([e['status'] for e in self.events if e['type'] == 'candidate_end'], ['failed', 'failed'])
        self.assertTrue(any(e['type'] == 'budget_decision' and e['estimate_source'] for e in self.events))

    def test_rollback_has_history_and_requires_diagnosis(self):
        result, _ = self.run_loop(FakeBackend([measured(wns_ns=0.4)], final=RuntimeError('recheck failed')), max_trials=1)
        self.assertEqual(result['outcome'], 'unverified_winner')
        self.assertEqual([e['label'] for e in self.events if e['type'] == 'best_updated'],
                         ['baseline', 'route_explore', 'baseline_after_failed_recheck'])

    def test_cancellation_closes_candidate_and_root(self):
        class CancelBackend(FakeBackend):
            async def measure(self, checkpoint, directory, play=None, timeout=180):
                if play:
                    raise asyncio.CancelledError()
                return await super().measure(checkpoint, directory, play, timeout)
        with tempfile.TemporaryDirectory(dir=ROOT / 'artifacts', prefix='optimizer-cancel-test-') as temp:
            source = Path(temp) / 'input.dcp'
            source.write_bytes(b'SYNTHETIC')
            with self.assertRaises(asyncio.CancelledError):
                asyncio.run(optimize({'checkpoint': str(source), 'mode': 'run'}, Path(temp) / 'result', lambda _: CancelBackend([])))
            result = json.loads((Path(temp) / 'result/optimizer-result.json').read_text(encoding='utf-8'))
            events = [json.loads(line) for line in (Path(temp) / 'result/optimizer-events.jsonl').read_text(encoding='utf-8').splitlines()]
            self.assertEqual(result['status'], 'cancelled')
            self.assertEqual(result['attempts'][0]['status'], 'cancelled')
            self.assertEqual(events[-1]['status'], 'cancelled')
            self.assertEqual(len([e for e in events if e['type'] == 'span_start']), len([e for e in events if e['type'] == 'span_end']))


@unittest.skipUnless(importlib.util.find_spec('mcp') and importlib.util.find_spec('vivado_mcp'),
                     'Run with runtime/vivado-community-venv/Scripts/python.exe for MCP backend tests')
class BackendTraceTests(unittest.IsolatedAsyncioTestCase):
    async def test_transport_failure_has_span_and_log_without_raw_arguments(self):
        from fpga_optimizer.backend import LocalVivado
        from fpga_optimizer.trace import OptimizerTrace
        from unittest.mock import AsyncMock
        with tempfile.TemporaryDirectory(dir=ROOT / 'artifacts', prefix='optimizer-mcp-test-') as temp:
            trace = OptimizerTrace(temp)
            backend = LocalVivado(temp, 'UNUSED-VIVADO')
            backend.trace = trace
            backend.client = type('FakeClient', (), {'call_tool': AsyncMock(side_effect=TimeoutError('transport timed out'))})()
            with self.assertRaises(TimeoutError):
                await backend.call('run_tcl', {'command': 'PRIVATE_TCL_SENTINEL', 'timeout': 10}, Path(temp) / 'response.log')
            text = trace.file.read_text(encoding='utf-8')
            events = [json.loads(line) for line in text.splitlines()]
            self.assertNotIn('PRIVATE_TCL_SENTINEL', text)
            self.assertTrue(backend.timed_out)
            self.assertEqual(events[-1]['status'], 'failed')
            self.assertTrue(any(e['type'] == 'evidence' and e['role'] == 'mcp_response' for e in events))

    async def test_cleanup_error_does_not_replace_original_error(self):
        from fpga_optimizer.backend import LocalVivado
        from unittest.mock import AsyncMock
        with tempfile.TemporaryDirectory(dir=ROOT / 'artifacts', prefix='optimizer-cleanup-test-') as temp:
            backend = LocalVivado(temp, 'UNUSED-VIVADO')
            backend.call = AsyncMock(side_effect=RuntimeError('cleanup failed'))
            original = ValueError('original failure')
            await backend.__aexit__(ValueError, original, None)
            self.assertTrue((Path(temp) / 'cleanup-errors.log').exists())
            with self.assertRaisesRegex(RuntimeError, 'Session cleanup failed'):
                await backend.__aexit__(None, None, None)


if __name__ == '__main__':
    unittest.main()
