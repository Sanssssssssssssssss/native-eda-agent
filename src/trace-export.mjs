// OTLP JSON serialization only. No uploader, credentials, raw commands or prompts.
import fs from 'node:fs';
import path from 'node:path';
import { inspectTrace } from '../scripts/trace-inspect.mjs';

const readEvents = file => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const ns = timestamp => {
  // Date.parse truncates sub-millisecond precision: restore the remaining digits.
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) throw new Error('Missing event timestamp');
  const fraction = timestamp.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] || '';
  return (BigInt(ms) * 1000000n + BigInt((fraction.padEnd(9, '0').slice(3, 9)) || '0')).toString();
};
const attributes = values => Object.entries(values).filter(([, value]) => value !== undefined && value !== null)
  .map(([key, value]) => ({ key, value: typeof value === 'boolean' ? { boolValue: value }
    : typeof value === 'number' ? { doubleValue: value } : { stringValue: String(value) } }));
const safeEvent = event => attributes(Object.fromEntries(
  ['status', 'play', 'candidate_id', 'allowed', 'wns_ns', 'tns_ns', 'estimated_seconds', 'remaining_seconds', 'accepted', 'passed', 'model_api_calls', 'error_type']
    .filter(key => typeof event[key] === 'number' || typeof event[key] === 'boolean' || (typeof event[key] === 'string' && /^[\w.-]{1,100}$/.test(event[key])))
    .map(key => [`eda.${key}`, event[key]])));

export function exportTraces(inputs) {
  const spans = [], seen = new Set(), runs = [], omitted = [];
  for (const input of inputs) {
    const directory = fs.realpathSync(input);
    const report = inspectTrace(directory, { timelineLimit: 0 });
    if (!report.valid) throw new Error(`Invalid evidence cannot be exported: ${directory}`);
    const batches = [];
    if (report.tool === 'optimizer') batches.push({ directory, tool: 'optimizer', file: 'optimizer-events.jsonl', status: report.status });
    else {
      batches.push({ directory, tool: report.tool, file: 'events.jsonl', status: report.status });
      if (report.optimizer?.connected) batches.push({ directory: report.optimizer.directory, tool: 'optimizer', file: 'optimizer-events.jsonl', status: report.optimizer.status });
      else if (report.optimizer) omitted.push({ run_id: report.run_id, reason: 'legacy_optimizer_has_no_spans' });
    }
    for (const batch of batches) {
      if (['running', 'initializing'].includes(batch.status)) throw new Error('Export requires a terminal run; no end time is invented.');
      const groups = new Map();
      for (const event of readEvents(path.join(batch.directory, batch.file))) {
        if (!/^[a-f0-9]{32}$/.test(event.trace_id || '') || !/^[a-f0-9]{16}$/.test(event.span_id || '')) throw new Error('Legacy events without span IDs cannot be exported.');
        const key = `${event.trace_id}:${event.span_id}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(event);
      }
      for (const [key, events] of groups) {
        if (seen.has(key)) continue;
        const start = events.find(e => ['run_start', 'optimizer_start', 'span_start', 'process_start'].includes(e.type));
        const end = events.findLast(e => ['run_end', 'optimizer_end', 'span_end', 'process_end'].includes(e.type));
        if (!start || !end) throw new Error(`Incomplete span cannot be exported: ${key}`);
        const startNs = ns(start.timestamp_utc), endNs = ns(end.timestamp_utc);
        if (BigInt(endNs) < BigInt(startNs)) throw new Error('Span end precedes start');
        const failed = ['failed', 'cancelled', 'timed_out', 'blocked_by_baseline', 'initialization_failed'].includes(end.status) ||
          (end.type === 'process_end' && end.termination_reason !== 'completed');
        const span = { traceId: start.trace_id, spanId: start.span_id,
          ...(start.parent_span_id ? { parentSpanId: start.parent_span_id } : {}),
          name: start.name || (start.type === 'process_start' ? 'eda.process' : batch.tool),
          kind: start.name === 'mcp_call' ? 3 : 1, startTimeUnixNano: startNs, endTimeUnixNano: endNs,
          status: { code: failed ? 2 : 1 }, attributes: attributes({ 'eda.tool': batch.tool, 'eda.status': end.status || end.termination_reason,
            'eda.evidence_valid': true, 'eda.functional_acceptance': 'not_inferred' }),
          links: events.filter(e => e.type === 'recovery_from' && /^[a-f0-9]{32}$/.test(e.source_trace_id || '') && /^[a-f0-9]{16}$/.test(e.source_span_id || ''))
            .map(e => ({ traceId: e.source_trace_id, spanId: e.source_span_id, attributes: attributes({ 'eda.relationship': 'recovered_from' }) })),
          events: events.map(event => ({ name: event.type, timeUnixNano: ns(event.timestamp_utc), attributes: safeEvent(event) })) };
        spans.push(span); seen.add(key);
      }
    }
    runs.push({ run_id: report.run_id, trace_id: report.trace_id });
  }
  return { payload: { resourceSpans: [{ resource: { attributes: attributes({ 'service.name': 'eda-agent', 'service.version': '0.2.0' }) },
    scopeSpans: [{ scope: { name: 'eda.local.trace', version: '1.0.0' }, spans }] }] },
    summary: { schema_version: 1, format: 'OTLP/JSON', span_count: spans.length, runs, omitted,
      uploaded: false, redaction: 'Allowlisted metadata only; no prompts, argument/response bodies, paths, credentials or error messages.',
      specification: 'https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding' } };
}
