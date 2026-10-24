// Offline summaries only: event bodies, prompts and process logs are never printed.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { verifyInputEvidence, validateTraceEvent } from '../src/trace.mjs';
import { inspectOptimizer } from '../src/optimizer-inspection.mjs';

const stable = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const digest = value => createHash('sha256').update(stable(value) || 'null').digest('hex');

export function inspectTrace(input, { timelineLimit = 20, checkCurrent = false } = {}) {
  const directory = fs.statSync(input).isDirectory() ? path.resolve(input) : path.dirname(path.resolve(input));
  const manifestFile = path.join(directory, 'run.json');
  if (!fs.existsSync(manifestFile) && ['optimizer-result.json', 'optimizer-events.jsonl'].some(name => fs.existsSync(path.join(directory, name)))) return inspectOptimizer(directory, { timelineLimit });
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Manifest must be an object.');
  }
  catch (error) { return { directory, valid: false, missing_evidence: ['Readable run.json'], validation_issues: [error.code || 'Invalid manifest JSON'], timeline: [] }; }
  const problems = [];
  const missing = [];
  const warnings = [];
  const events = [];
  const piSession = manifest.mode === 'pi-sdk-agent';
  if (piSession) {
    // Normalize documented SDK aliases only. Never invent historical event IDs/times.
    manifest = { ...manifest, run_id: manifest.run_id ?? manifest.runId,
      schema_version: manifest.schema_version ?? manifest.schemaVersion,
      started_at: manifest.started_at ?? manifest.startedAt, finished_at: manifest.finished_at ?? manifest.endedAt,
      duration_ms: manifest.duration_ms ?? (typeof manifest.wallSeconds === 'number' ? manifest.wallSeconds * 1000 : null),
      inputs: Array.isArray(manifest.inputs) ? manifest.inputs.map(item => ({ ...item, relative_path: item.relative_path ?? item.path })) : manifest.inputs };
    warnings.push('Pi SDK field aliases normalized for inspection; snapshots cover listed orchestration files only.');
    if (checkCurrent && !manifest.workspace) problems.push('Legacy Pi manifest has no workspace for current-file verification.');
  }
  if (typeof manifest.run_id !== 'string' || !manifest.run_id) problems.push('Missing or invalid manifest run ID.');
  if (typeof manifest.status !== 'string' || !manifest.status) problems.push('Missing manifest status.');
  const eventsFile = path.join(directory, 'events.jsonl');
  if (!fs.existsSync(eventsFile)) missing.push('events.jsonl');
  else {
    const lines = fs.readFileSync(eventsFile, 'utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index].trim()) continue;
      try {
        let event = JSON.parse(lines[index]);
        if (piSession) event = { ...event, seq: event.seq ?? event.sequence, run_id: event.run_id ?? event.agent_run_id,
          parent_span_id: event.parent_span_id ?? null };
        const issues = validateTraceEvent(event, { expectedSeq: events.length + 1, runId: manifest.run_id, requireSpans: Boolean(manifest.trace_id && manifest.span_id) });
        problems.push(...issues.map(issue => `Event line ${index + 1}: ${issue}`));
        if (manifest.trace_id && event.trace_id !== manifest.trace_id) problems.push(`Event line ${index + 1}: trace ID differs from manifest.`);
        events.push(event);
      } catch { problems.push(`Event line ${index + 1}: invalid JSON.`); }
    }
  }
  if (!manifest.trace_id) warnings.push('Legacy run has no common trace/span IDs.');
  for (const event of events.filter(event => event.type === 'mcp_response')) {
    try {
      const file = fs.realpathSync(path.resolve(directory,event.response_file));
      const relative = path.relative(fs.realpathSync(directory),file);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== event.sha256) problems.push('MCP response evidence hash or path mismatch.');
    } catch { missing.push('Readable MCP response evidence'); }
  }
  if (manifest.coverage) warnings.push(manifest.coverage);
  if (!events.length) missing.push('Readable event timeline');
  if (!['running', 'initializing'].includes(manifest.status) && !events.some(event => event.type === 'run_end' || event.type === 'agent_end')) missing.push('Terminal event');
  const processes = Array.isArray(manifest.processes) ? manifest.processes.filter(item => item && typeof item === 'object') : [];
  if (Array.isArray(manifest.processes) && processes.length !== manifest.processes.length) problems.push('Malformed process record.');
  for (const process of processes) {
    if (!events.some(event => event.type === 'process_start' && event.process_id === process.process_id)) missing.push(`Process ${process.process_id} start event`);
    if (manifest.status !== 'running' && !events.some(event => event.type === 'process_end' && event.process_id === process.process_id)) missing.push(`Process ${process.process_id} terminal event`);
    if (manifest.status !== 'running' && !process.ended_at) missing.push(`Process ${process.process_id} ended_at`);
  }
  if (processes.length && !fs.existsSync(path.join(directory, 'process.log'))) missing.push('process.log');
  const integrity = verifyInputEvidence(manifest, directory, { checkCurrent: checkCurrent && Boolean(manifest.workspace) });
  problems.push(...integrity.issues);
  if (!Array.isArray(manifest.inputs) || !manifest.inputs.length) missing.push('Captured input list');
  if (manifest.unresolved_dependencies?.length) warnings.push(`${manifest.unresolved_dependencies.length} unresolved dependencies.`);
  if (manifest.input_drift) warnings.push('Inputs changed during this run.');
  if (manifest.status === 'running') warnings.push('Run has no terminal state yet.');
  if (manifest.schema_version !== 1) warnings.push('Unknown manifest schema version.');
  let receipt = {}, usage = {};
  for (const [name, set] of [['receipt.json', value => { receipt = value; }], ['usage.json', value => { usage = value; }]]) {
    const file = path.join(directory, name);
    if (fs.existsSync(file)) { try { set(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { problems.push(`Invalid ${name}.`); } }
    else if (name === 'receipt.json' && manifest.tool && manifest.status !== 'running') missing.push(name);
  }
  const metrics = Object.fromEntries(Object.entries(receipt.build_result || {}).filter(([, value]) => typeof value === 'number' || typeof value === 'boolean'));
  let optimizer;
  const optimizerDirectory = path.join(directory, 'optimizer');
  const linked = events.some(event => event.type === 'optimizer_link');
  if (manifest.tool === 'eda_vivado_optimize' && fs.existsSync(optimizerDirectory)) {
    optimizer = inspectOptimizer(optimizerDirectory, { parent: manifest, timelineLimit });
    if (linked || optimizer.connected) {
      if (!optimizer.valid) problems.push(...optimizer.validation_issues.map(issue => `Optimizer: ${issue}`));
      if (!optimizer.connected) missing.push('Optimizer causal trace metadata');
    } else warnings.push('Legacy optimizer has result/log evidence only; inner decisions are not correlated spans.');
  } else if (linked) missing.push('Linked optimizer directory');
  const timeline = events.map(event => ({ seq: event.seq, at: event.timestamp_utc, type: event.type,
    span_id: event.span_id, parent_span_id: event.parent_span_id, process_id: event.process_id,
    duration_ms: event.duration_ms, status: event.status, termination_reason: event.termination_reason || event.reason }));
  return { directory, run_id: manifest.run_id, tool: manifest.tool || manifest.mode || 'agent', status: manifest.status,
    trace_id: manifest.trace_id || null, span_id: manifest.span_id || null, parent_span_id: manifest.parent_span_id || null, context: manifest.context || {},
    started_at: manifest.started_at, finished_at: manifest.finished_at, duration_ms: manifest.duration_ms ?? null,
    valid: problems.length === 0 && missing.length === 0, validation_issues: problems, missing_evidence: missing, warnings,
    input_drift: Boolean(manifest.input_drift), unresolved_dependencies: manifest.unresolved_dependencies || [],
    snapshot_integrity: integrity, input_count: Array.isArray(manifest.inputs) ? manifest.inputs.length : 0,
    input_hashes: Object.fromEntries((Array.isArray(manifest.inputs) ? manifest.inputs : []).filter(item => item && typeof item.relative_path === 'string').map(item => [item.relative_path, item.sha256])),
    parameters_sha256: digest(manifest.arguments), tool_version: manifest.tool_version ?? null,
    runtime: manifest.runtime || null, metrics, optimizer, process_count: processes.length,
    process_outcomes: processes.map(item => ({ process_id: item.process_id, span_id: item.span_id, executable: path.basename(item.exe || ''), duration_ms: item.duration_ms, exit_code: item.exit_code, termination_reason: item.termination_reason })),
    usage: usage.stats || manifest.usage || null,
    event_count: events.length, timeline: timeline.slice(0, Math.max(0, timelineLimit)), timeline_omitted: Math.max(0, timeline.length - timelineLimit),
    boundary: 'Completed tool execution is separate from functional acceptance. Static dependency discovery is incomplete; integrity covers recorded inputs only.' };
}

export function compareTraces(left, right) {
  const names = new Set([...Object.keys(left.input_hashes || {}), ...Object.keys(right.input_hashes || {})]);
  const inputs = [...names].filter(name => left.input_hashes?.[name] !== right.input_hashes?.[name]).map(name => ({ path: name, before: left.input_hashes?.[name] ?? null, after: right.input_hashes?.[name] ?? null }));
  const metrics = {};
  for (const key of new Set([...Object.keys(left.metrics || {}), ...Object.keys(right.metrics || {})])) {
    const a = left.metrics?.[key], b = right.metrics?.[key];
    if (a !== b) metrics[key] = { before: a ?? null, after: b ?? null, delta: typeof a === 'number' && typeof b === 'number' ? b - a : null };
  }
  return { before: left.run_id, after: right.run_id, status: { before: left.status, after: right.status },
    parameters_changed: left.parameters_sha256 !== right.parameters_sha256, tool_version_changed: left.tool_version !== right.tool_version,
    runtime_changed: stable(left.runtime) !== stable(right.runtime), changed_inputs: inputs, changed_metrics: metrics,
    duration_delta_ms: typeof left.duration_ms === 'number' && typeof right.duration_ms === 'number' ? right.duration_ms - left.duration_ms : null,
    evidence_valid: left.valid && right.valid, acceptance_comparison: 'Not inferred from tool status or timing alone.' };
}

export function summarizeTraces(runs) {
  const byTool = {};
  for (const run of runs) {
    const tool = run.tool || 'unknown';
    const row = byTool[tool] ||= { runs: 0, completed: 0, planned: 0, failed: 0, unfinished: 0, invalid_evidence: 0, drifted: 0, duration_ms: 0 };
    row.runs++; if (run.status === 'completed') row.completed++; else if (run.status === 'planned') row.planned++;
    else if (['running', 'initializing'].includes(run.status)) row.unfinished++; else row.failed++;
    if (!run.valid) row.invalid_evidence++; if (run.input_drift) row.drifted++; row.duration_ms += run.duration_ms || 0;
  }
  return { run_count: runs.length, by_tool: byTool, acceptance: 'No benchmark pass rate is inferred from these execution counts.' };
}

function renderMarkdown(report) {
  const lines = ['# Trace inspection', '', `Runs: ${report.aggregate.run_count}. Execution completion is separate from acceptance.`, '',
    '| Run | Tool | Status | Inputs | Processes | Evidence valid |', '|---|---|---|---:|---:|---|',
    ...report.runs.map(run => `| ${run.run_id || run.directory} | ${run.tool || '?'} | ${run.status || '?'} | ${run.input_count || 0} | ${run.process_count || 0} | ${run.valid} |`)];
  for (const run of report.runs) {
    const findings = [...(run.validation_issues || []), ...(run.missing_evidence || []).map(item => `Missing: ${item}`), ...(run.warnings || [])];
    if (findings.length) lines.push('', `**${run.run_id || run.directory}**`, '', ...findings.map(item => `- ${item}`));
    const optimizer = run.optimizer || (run.tool === 'optimizer' ? run : null);
    if (optimizer) lines.push('', `Optimizer: ${optimizer.outcome}; connected: ${optimizer.connected}; evidence valid: ${optimizer.valid}; terminal: ${optimizer.complete}.`,
      `Next action: ${optimizer.next_action}`, ...(optimizer.warnings || []).map(item => `- ${item}`));
  }
  if (report.comparison) lines.push('', `Comparison: ${report.comparison.changed_inputs.length} changed inputs; parameters changed: ${report.comparison.parameters_changed}; duration delta: ${report.comparison.duration_delta_ms ?? 'unknown'} ms.`);
  return lines.join('\n') + '\n';
}

function main() {
  const args = process.argv.slice(2), inputs = [];
  let format = 'json', output, compare, limit = 20, checkCurrent = false;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--format') format = args.shift();
    else if (arg === '--output') output = args.shift();
    else if (arg === '--compare') compare = args.shift();
    else if (arg === '--timeline-limit') limit = Number(args.shift());
    else if (arg === '--check-current') checkCurrent = true;
    else if (!arg.startsWith('--')) inputs.push(arg);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!inputs.length || !['json', 'md'].includes(format) || !Number.isSafeInteger(limit) || limit < 0) throw new Error('Usage: node scripts/trace-inspect.mjs RUN_OR_ARTIFACTS_DIR [...] [--compare RUN] [--check-current] [--timeline-limit 20] [--format json|md] [--output FILE]');
  const isRun = input => ['run.json', 'receipt.json', 'process.log', 'optimizer-result.json', 'optimizer-events.jsonl'].some(name => fs.existsSync(path.join(input, name)));
  const resolved = inputs.flatMap(input => fs.statSync(input).isDirectory() && !isRun(input)
    ? fs.readdirSync(input, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && isRun(path.join(input, entry.name))).map(entry => path.join(input, entry.name)) : [input]);
  const runs = resolved.map(input => inspectTrace(input, { timelineLimit: limit, checkCurrent }));
  const report = { schema_version: 1, inspected_at: new Date().toISOString(), aggregate: summarizeTraces(runs), runs };
  if (compare) {
    if (runs.length !== 1) throw new Error('--compare requires one source run.');
    const other = inspectTrace(compare, { timelineLimit: limit, checkCurrent });
    report.runs.push(other); report.aggregate = summarizeTraces(report.runs); report.comparison = compareTraces(runs[0], other);
  }
  const text = format === 'md' ? renderMarkdown(report) : JSON.stringify(report, null, 2) + '\n';
  if (output) { fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(output, text); console.log(`Trace summary saved: ${path.resolve(output)}`); }
  else process.stdout.write(text);
  if (report.runs.some(run => !run.valid)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
