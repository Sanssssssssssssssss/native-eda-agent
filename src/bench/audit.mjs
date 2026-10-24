import fs from 'node:fs';
import path from 'node:path';
import { verifyInputEvidence } from '../trace.mjs';

// Read-only derivation; callers can persist the returned object beside the original summary.
export function auditCampaign(runDirectory) {
  const directory = path.resolve(runDirectory);
  const summary = JSON.parse(fs.readFileSync(path.join(directory, 'summary.json'), 'utf8'));
  const cases = summary.cases.map(item => {
    const receipt = item.tool_receipt;
    if (!receipt?.run_manifest) return { id: item.id, acceptance: item.acceptance.status, tool_status: item.tool_status, process_count: 0, queue_wait_ms: 0, process_duration_ms: 0, case_duration_ms: item.duration_ms, no_native_run: true };
    const manifest = JSON.parse(fs.readFileSync(receipt.run_manifest, 'utf8'));
    const events = fs.readFileSync(path.join(receipt.directory, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const queue = events.find(event => event.type === 'state_transition' && event.status === 'running')?.queue_wait_ms
      ?? events.find(event => event.type === 'hook_end' && event.hook === 'resource_acquire')?.duration_ms ?? 0;
    const processDuration = manifest.processes.reduce((sum, record) => sum + (record.duration_ms || 0), 0);
    const inputIntegrity = verifyInputEvidence(manifest, receipt.directory);
    const parent = item.trace_directory ? JSON.parse(fs.readFileSync(path.join(item.trace_directory, 'run.json'), 'utf8')) : null;
    const contextLinked = Boolean(parent && manifest.context?.campaign_id === summary.run_id && manifest.context?.case_id === item.id && manifest.context?.parent_run_id === parent.run_id && manifest.trace_id === parent.trace_id && manifest.context?.parent_span_id === parent.span_id);
    return { id: item.id, acceptance: item.acceptance.status, tool_status: item.tool_status, tool_exit: item.tool_exit,
      process_count: manifest.processes.length, case_duration_ms: item.duration_ms, queue_wait_ms: Math.round(queue),
      process_duration_ms: processDuration, native_duration_ms: manifest.duration_ms,
      native_overhead_ms: Math.round(manifest.duration_ms - queue - processDuration),
      orchestration_overhead_ms: item.duration_ms - manifest.duration_ms,
      timeout_while_queued: item.acceptance.status === 'TIMEOUT' && manifest.processes.length === 0,
      snapshot_integrity: inputIntegrity.valid, input_drift: manifest.input_drift,
      context_linked: contextLinked, acceptance_matches_case_manifest: !parent || JSON.stringify(parent.acceptance) === JSON.stringify(item.acceptance),
      native_directory: receipt.directory, unresolved_dependencies: manifest.unresolved_dependencies.length };
  });
  const native = cases.filter(item => !item.no_native_run);
  const grouped = field => Object.fromEntries([...new Set(summary.cases.map(item => item[field]))].sort().map(key => {
    const items = summary.cases.filter(item => item[field] === key);
    return [key, { cases: items.length, families: new Set(items.map(item => item.family)).size,
      statuses: Object.fromEntries([...new Set(items.map(item => item.acceptance.status))].sort().map(status => [status, items.filter(item => item.acceptance.status === status).length])) }];
  }));
  return { schema_version: 1, derived_at: new Date().toISOString(), source_summary: path.join(directory, 'summary.json'),
    run_id: summary.run_id, status: summary.status, counts: summary.counts, completed_cases: cases.length, selected_cases: summary.case_count,
    wall_duration_ms: summary.duration_ms ?? null,
    aggregate_queue_ms: native.reduce((sum, item) => sum + item.queue_wait_ms, 0),
    aggregate_process_ms: native.reduce((sum, item) => sum + item.process_duration_ms, 0),
    queue_timeout_cases: native.filter(item => item.timeout_while_queued).map(item => item.id),
    all_native_snapshots_valid: native.every(item => item.snapshot_integrity),
    all_native_context_linked: native.every(item => item.context_linked),
    all_case_acceptance_consistent: native.every(item => item.acceptance_matches_case_manifest),
    groups: { category: grouped('category'), tier: grouped('tier'), origin: grouped('origin') },
    cases, note: 'Derived metrics retain original results. Aggregate times sum concurrent cases and are not wall time; queue waiting is not simulator performance.' };
}
