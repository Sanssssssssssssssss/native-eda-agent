import { verdict } from '../../scripts/verilogeval-verdict.mjs';

const output = (status, passed, reason, extra = {}) => ({ status, passed, reason, ...extra });
export function guardIntegrity(acceptance, { input_drift = false, snapshot_integrity = true } = {}) {
  return input_drift || snapshot_integrity === false ? output('INCOMPLETE', false, input_drift ? 'Input changed during execution.' : 'Snapshot integrity verification failed.') : acceptance;
}
function measurement(text, name) {
  const line = text.split(/\r?\n/).find(line => new RegExp(`^\\s*${name}\\s*:`, 'i').test(line));
  if (!line) return NaN;
  const number = '([-+]?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
  if (name === 'cutoff_hz') return Number(line.match(new RegExp(`\\bAT\\s*=?\\s*${number}`, 'i'))?.[1]);
  const db = line.match(new RegExp(`=\\s*\\(\\s*${number}\\s*dB`, 'i'));
  return db ? 10 ** (Number(db[1]) / 20) : Number(line.match(new RegExp(`=\\s*${number}`, 'i'))?.[1]);
}

export function evaluateAcceptance(spec, { receipt, transcript = '', error = null, tool_exit = null, timedOut = false, oracleResult = null }) {
  transcript = transcript.replaceAll('\r\n', '\n');
  const timeout = timedOut || receipt?.status === 'timed_out' || /(?:^|\n)\s*(?:\[?TIMEOUT\]?\b|BENCH_TIMEOUT\b)|\b(?:GLOBAL_TIMEOUT|SIM_TIMEOUT)\b/i.test(transcript);
  if (timeout) return output(spec.kind === 'expected_timeout' ? 'EXPECTED_TIMEOUT' : 'TIMEOUT', false, 'Execution or simulation timed out; never a design PASS.', { expected: spec.kind === 'expected_timeout' });
  if (receipt?.status === 'cancelled') return output('INCOMPLETE', false, 'Execution was cancelled.');
  if (spec.kind === 'expected_failure') {
    const failed = receipt?.status === 'failed' && tool_exit !== 0;
    return failed && new RegExp(spec.error_pattern, 'i').test(`${error || ''}\n${receipt?.error || ''}\n${transcript}`)
      ? output('EXPECTED_FAILURE', true, 'The deliberate negative control was rejected as specified.')
      : output('FAIL', false, 'Expected rejection was absent or had a different cause.');
  }
  if (!receipt || receipt.status !== 'completed' || tool_exit !== 0) return output(error ? 'FAIL' : 'INCOMPLETE', false, error || 'No completed tool invocation with exit 0.');
  if (/(?:^|\n)\s*(?:Fatal:|ERROR:|BENCH_FAIL\b|COUNTER_FAIL\b)/im.test(transcript)) return output('FAIL', false, 'Failure diagnostics override a pass marker.');
  if (spec.kind === 'marker') {
    const match = new RegExp(`^${spec.pattern}$`, 'm').exec(transcript);
    if (!match) return output('INCOMPLETE', false, 'Required completion marker is missing.');
    if (spec.checks !== undefined && Number(match[1]) !== spec.checks) return output('FAIL', false, 'Observed check count differs from the frozen requirement.');
    return output('PASS', true, 'Completion marker and required checks observed.', { checks: spec.checks ?? null });
  }
  if (spec.kind === 'verilogeval') {
    const result = verdict(transcript);
    return output(result.passed ? 'PASS' : result.timed_out ? 'TIMEOUT' : 'FAIL', result.passed, 'Original upstream mismatch/sample/timeout policy.', result);
  }
  if (spec.kind === 'rc') {
    const targets = { cutoff_hz: 1 / (2 * Math.PI * 1000 * 100e-9), gain_1k: 1 / Math.sqrt(1 + (2 * Math.PI * 1000 * 1000 * 100e-9) ** 2), v_at_tau: 1 - Math.exp(-1), v_final: 1 - Math.exp(-10) };
    const measurements = Object.fromEntries(spec.names.map(name => {
      const actual = measurement(receipt.measurements_and_log || transcript, name), expected = targets[name];
      return [name, { actual: Number.isFinite(actual) ? actual : null, expected, relative_error: Math.abs(actual - expected) / expected }];
    }));
    const passed = Object.values(measurements).every(item => item.actual !== null && Number.isFinite(item.relative_error) && item.relative_error <= spec.relative_tolerance);
    return output(passed ? 'PASS' : 'FAIL', passed, 'Independent RC equations with frozen relative tolerance.', { measurements });
  }
  if (spec.kind === 'routed') {
    const build = receipt.build_result;
    const passed = build?.stage === 'routed' && Number.isFinite(build.setup_slack_ns) && build.setup_slack_ns >= 0 && Number.isFinite(build.hold_slack_ns) && build.hold_slack_ns >= 0 && build.clock_period_ns === 10 && (build.black_boxes === undefined || build.black_boxes === 0);
    return output(passed ? 'PASS' : 'FAIL', passed, 'Routed 100 MHz timing evidence required.', { build: build || null });
  }
  if (spec.kind === 'fft') {
    const passed = receipt.build_result?.passed === true && oracleResult?.passed === true && oracleResult.bins_checked > 0 && /SPECTRUM_SIM_PASS/.test(transcript);
    return output(passed ? 'PASS' : 'FAIL', passed, 'FFT simulation and independent NumPy oracle required.', { oracle: oracleResult });
  }
  if (spec.kind === 'node_tests') {
    const passed = /^# fail 0\s*$/m.test(transcript) && /^# pass [1-9]\d*\s*$/m.test(transcript) && /^1\.\.[1-9]\d*\s*$/m.test(transcript);
    return output(passed ? 'PASS' : 'INCOMPLETE', passed, 'Complete TAP plan with positive tests and zero failures required.');
  }
  return output('FAIL', false, `Unsupported acceptance kind: ${spec.kind}`);
}
