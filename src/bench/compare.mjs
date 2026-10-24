import fs from 'node:fs';
import path from 'node:path';
function summary(value) { return typeof value === 'string' ? JSON.parse(fs.readFileSync(path.join(path.resolve(value), 'summary.json'), 'utf8')) : value; }
export function compareRuns(baseline, candidate) {
  baseline = summary(baseline); candidate = summary(candidate);
  if (baseline?.schema_version !== 1 || candidate?.schema_version !== 1) throw new Error('Unsupported benchmark summaries');
  const left = new Map(baseline.cases.map(item => [item.id, item])), right = new Map(candidate.cases.map(item => [item.id, item]));
  const cases = [...new Set([...left.keys(), ...right.keys()])].sort().map(id => {
    const before = left.get(id), after = right.get(id), reasons = [], warnings = [];
    if (!before || !after) reasons.push(!before ? 'not_in_baseline' : 'not_in_candidate');
    else {
      for (const key of ['family', 'variant', 'seed', 'case_definition_sha256', 'catalog_version', 'catalog_sha256', 'task_sha256', 'generator_sha256', 'acceptance_sha256', 'tool_environment_sha256']) if (before[key] !== after[key] || before[key] === undefined || before[key] === null) reasons.push(`${key}_differs_or_missing`);
      if (before.runtime_sha256 !== after.runtime_sha256) warnings.push('runtime_source_changed');
      if (before.candidate_sha256 !== after.candidate_sha256) warnings.push('candidate_design_changed');
      if (before.unresolved_dependencies?.length || after.unresolved_dependencies?.length) reasons.push('unresolved_dependencies');
      if (['BLOCKED', 'INCOMPLETE', 'TIMEOUT'].includes(before.acceptance.status) || ['BLOCKED', 'INCOMPLETE', 'TIMEOUT'].includes(after.acceptance.status)) reasons.push('incomplete_evidence');
    }
    const comparable = reasons.length === 0;
    const change = !comparable ? 'INCOMPARABLE' : before.acceptance.status === after.acceptance.status ? 'UNCHANGED'
      : after.acceptance.status === 'PASS' ? 'IMPROVED' : before.acceptance.status === 'PASS' ? 'REGRESSED' : 'CHANGED';
    return { id, comparable, reasons, warnings, candidate_changed: before?.candidate_sha256 !== after?.candidate_sha256, change, baseline: before?.acceptance.status || null, candidate: after?.acceptance.status || null,
      duration_delta_ms: comparable ? after.duration_ms - before.duration_ms : null };
  });
  return { schema_version: 1, baseline_run_id: baseline.run_id, candidate_run_id: candidate.run_id,
    comparable: cases.filter(item => item.comparable).length, incomparable: cases.filter(item => !item.comparable).length,
    regressions: cases.filter(item => item.change === 'REGRESSED').length, cases,
    note: 'Task/test inputs, generator, seed, acceptance and tool environment must match. Candidate RTL changes are reported and remain comparable; runtime source changes are warnings. Timing differences are observations, not isolated performance experiments.' };
}
