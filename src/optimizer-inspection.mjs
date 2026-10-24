// Offline only. Raw Tcl, prompts and MCP response bodies never enter the summary.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateTraceEvent } from './trace.mjs';

const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export function inspectOptimizer(directory, { parent, timelineLimit = 20 } = {}) {
  directory = fs.realpathSync(directory);
  const issues = [], warnings = [], events = [], evidence = new Set();
  let result = {};
  try {
    result = read(path.join(directory, 'optimizer-result.json'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) { result = {}; throw new Error('Invalid result'); }
  }
  catch { issues.push('Missing or unreadable optimizer-result.json.'); }
  const metadata = result?.trace || {};
  const connected = Boolean(metadata.trace_id && metadata.span_id);
  const file = path.join(directory, 'optimizer-events.jsonl');
  if (!connected) warnings.push('Legacy or interrupted optimizer has no saved causal trace metadata; historical spans cannot be reconstructed.');
  if (fs.existsSync(file)) {
    for (const [index, line] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        issues.push(...validateTraceEvent(event, { expectedSeq: events.length + 1, runId: metadata.run_id, requireSpans: true }).map(x => `Event ${index + 1}: ${x}`));
        if (metadata.trace_id && event.trace_id !== metadata.trace_id) issues.push(`Event ${index + 1}: trace ID mismatch.`);
        events.push(event);
      } catch { issues.push(`Event ${index + 1}: invalid JSON.`); }
    }
  } else if (connected) issues.push('Missing optimizer-events.jsonl.');
  if (parent && connected && (metadata.trace_id !== parent.trace_id || metadata.parent_span_id !== parent.span_id || metadata.parent_run_id !== parent.run_id)) {
    issues.push('Optimizer parent trace/span/run does not match the native tool.');
  }
  const spans = new Map(), open = new Set();
  if (connected) spans.set(metadata.span_id, metadata.parent_span_id);
  let ended = false, terminal;
  const safeFile = value => {
    const target = fs.realpathSync(path.resolve(directory, value));
    const rel = path.relative(directory, target);
    if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) || !fs.statSync(target).isFile()) throw new Error('Evidence path escapes optimizer directory.');
    return target;
  };
  for (const event of events) {
    if (ended) issues.push('Events occur after optimizer_end.');
    if (event.type === 'span_start') {
      if (spans.has(event.span_id) || !spans.has(event.parent_span_id) || (event.parent_span_id !== metadata.span_id && !open.has(event.parent_span_id))) issues.push(`Invalid parent or duplicate span at event ${event.seq}.`);
      spans.set(event.span_id, event.parent_span_id); open.add(event.span_id);
    } else if (!spans.has(event.span_id) || spans.get(event.span_id) !== event.parent_span_id || (event.span_id !== metadata.span_id && !open.has(event.span_id))) {
      issues.push(`Unknown, closed or reparented span at event ${event.seq}.`);
    }
    if (event.type === 'span_end') {
      if (!open.delete(event.span_id)) issues.push(`Unmatched span_end at event ${event.seq}.`);
      if ([...open].some(id => spans.get(id) === event.span_id)) issues.push(`Parent span closed before child at event ${event.seq}.`);
    }
    if (event.type === 'evidence') {
      try {
        const target = safeFile(event.path);
        if (sha(target) !== event.sha256 || fs.statSync(target).size !== event.bytes) issues.push(`Evidence hash/size mismatch: ${event.path}`);
        evidence.add(target);
      } catch { issues.push(`Missing or unsafe evidence: ${event.path}`); }
    }
    if (event.type === 'optimizer_end') { ended = true; terminal = event; }
  }
  if (connected && (events[0]?.type !== 'optimizer_start' || events[0]?.span_id !== metadata.span_id)) issues.push('Missing optimizer_start root event.');
  const complete = Boolean(terminal && result.status !== 'running');
  if (terminal && (terminal.status !== result.status || terminal.outcome !== result.outcome || terminal.input_unchanged !== result.input_unchanged)) issues.push('Terminal event and result disagree.');
  if (!complete && connected) warnings.push('No consistent terminal state; check eda_runs before deciding whether the process is still active.');
  if (connected && result.status !== 'running' && !terminal) issues.push('Saved terminal result has no terminal event.');
  if (complete && open.size) issues.push('Terminal optimizer contains unfinished spans.');
  if (parent && parent.status !== 'running' && connected && !complete) issues.push('Native tool ended but optimizer evidence is incomplete.');
  if (parent?.status === 'completed' && connected && !['completed', 'planned'].includes(result.status)) issues.push('Native completion disagrees with optimizer status.');
  if (result.best) {
    try {
      const pointer = read(path.join(directory, 'best.json'));
      if (stable(pointer) !== stable(result.best)) issues.push('best.json differs from optimizer-result.json.');
      const target = safeFile(result.best.checkpoint);
      if (sha(target) !== result.best.sha256) issues.push('Best checkpoint hash mismatch.');
      if (connected && !evidence.has(target)) issues.push('Best checkpoint lacks a recorded evidence hash.');
      const promotion = events.findLast(event => event.type === 'best_updated');
      if (connected && (promotion?.label !== result.best.label || promotion?.sha256 !== result.best.sha256 || promotion?.checkpoint !== result.best.checkpoint)) issues.push('Best pointer disagrees with promotion history.');
    } catch { issues.push('Best pointer/checkpoint missing, malformed or outside optimizer directory.'); }
  }
  for (const attempt of Array.isArray(result.attempts) ? result.attempts : []) {
    if (!connected) break;
    const end = events.filter(event => event.type === 'candidate_end' && event.candidate_id === attempt.candidate_id);
    if (complete && (end.length !== 1 || end[0].status !== attempt.status || end[0].accepted !== attempt.accepted)) issues.push(`Candidate terminal mismatch: ${attempt.candidate_id}`);
  }
  if (complete && result.input_unchanged !== true) issues.push('Optimizer input integrity did not pass.');
  const valid = connected && issues.length === 0;
  const reviewable = valid && complete && result.status === 'completed' && result.winner_recheck?.passed === true && (!parent || parent.status === 'completed');
  const timeline = events.map(({ seq, timestamp_utc, type, name, span_id, parent_span_id, candidate_id, status, reason, allowed, duration_ms }) =>
    ({ seq, timestamp_utc, type, name, span_id, parent_span_id, candidate_id, status, reason, allowed, duration_ms }));
  return { directory, tool: 'optimizer', run_id: metadata.run_id || null, status: result.status || 'unknown',
    trace_id: metadata.trace_id || null, span_id: metadata.span_id || null, parent_span_id: metadata.parent_span_id || null,
    connected, coverage: connected ? 'optimizer_decisions_candidates_mcp' : 'legacy_result_only',
    valid, complete, validation_issues: issues, warnings, outcome: result.outcome || 'legacy_unknown',
    stop_reason: result.stop_reason, next_action: !connected && !issues.length ? 'Legacy result has no causal trace. Review the original receipt, measurements and logs; no automatic optimizer replay.'
      : !valid ? 'Inspect missing/corrupt evidence; do not accept or resume this result.'
      : !complete ? 'Use eda_runs to inspect ownership. Start a fresh run after diagnosis; no automatic resume.' : result.next_action,
    reviewable_checkpoint: reviewable ? result.best?.checkpoint : null, functional_acceptance: 'not_inferred',
    event_count: events.length, span_count: spans.size, open_spans: open.size, checked_artifacts: evidence.size,
    candidate_count: result.attempts?.length || 0, candidate_errors: result.attempts_with_errors ?? null,
    gain_ns: result.wns_gain_ns ?? null, model_api_calls: result.model_api_calls ?? null,
    timeline: timeline.slice(0, timelineLimit), timeline_omitted: Math.max(0, timeline.length - timelineLimit),
    boundary: 'Hashes check retained evidence, not authenticity or functional correctness. Running state alone cannot establish process liveness. No EDA process or model is invoked.' };
}
