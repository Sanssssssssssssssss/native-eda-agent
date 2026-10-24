import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { listRuns, pidAlive } from './runtime.mjs';
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const inside = (base, file) => { const rel = path.relative(base, file); return rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };
const sourceFiles = ['src/fpga_optimizer/core.py','src/fpga_optimizer/runner.py','src/fpga_optimizer/backend.py',
  'src/fpga_optimizer/trace.py','src/fpga_optimizer/recovery.py','src/tools/vivado-common.tcl','src/vivado_workbench.py',
  '.eda/optimizer-upstreams.json','vendor/routeagents-fpl26/optimizer/recipe_router.py'];

export function prepareRecovery(root, input) {
  const issues = [], warnings = [];
  let source, journal, manifest, checksum, events = [];
  try {
    const base = fs.realpathSync(path.join(root, 'artifacts'));
    source = fs.realpathSync(path.resolve(root, input));
    if (fs.existsSync(path.join(source, 'optimizer'))) source = fs.realpathSync(path.join(source, 'optimizer'));
    if (!inside(base, source)) throw new Error('Recovery path must be inside workspace artifacts');
    const parent = path.dirname(source);
    manifest = read(path.join(parent, 'run.json'));
    if (manifest.tool !== 'eda_vivado_optimize') throw new Error('Expected a native optimizer parent manifest');
    if (manifest.status === 'completed') throw new Error('Run already completed; use a new experiment instead of recovery');
    const state = listRuns(root).find(row => row.run_id === manifest.run_id);
    if (!state) throw new Error('Runtime ownership evidence missing');
    if (!['completed','failed','cancelled','timed_out','interrupted'].includes(state.status) && state.owner_alive !== false) throw new Error('Original owner is active or unknown');
    if (manifest.owned_backend_pid != null && pidAlive(manifest.owned_backend_pid) !== false) throw new Error('Owned backend is active or unknown');
    if (!Array.isArray(manifest.processes) || manifest.processes.some(item => !item.ended_at && pidAlive(item.pid) !== false)) throw new Error('Original child process is active or unknown');
    const file = path.join(source, 'recovery.json');
    journal = read(file); checksum = sha(file);
    if (!journal.owner || !Number.isInteger(journal.owner.python_pid)) throw new Error('Committed process ownership missing');
    for (const pid of [journal.owner.python_pid,journal.owner.engine_pid].filter(value=>value!=null)) {
      if (pidAlive(pid) !== false) throw new Error('Committed optimizer/engine process is active or unknown');
    }
    if (journal.schema_version !== 1 || journal.trace.parent_run_id !== manifest.run_id || journal.trace.trace_id !== manifest.trace_id || journal.trace.parent_span_id !== manifest.span_id) throw new Error('Recovery journal parent mismatch');
    const lines = fs.readFileSync(path.join(source, 'optimizer-events.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean);
    for (let index = 0; index < lines.length; index++) {
      let event;
      try { event = JSON.parse(lines[index]); }
      catch { if (index !== lines.length - 1) throw new Error('Corrupt event inside journal'); warnings.push('Incomplete final event ignored; committed prefix only'); break; }
      if (event.seq !== index + 1 || event.run_id !== journal.trace.run_id || event.trace_id !== journal.trace.trace_id) throw new Error('Recovery event sequence or trace mismatch');
      events.push(event);
    }
    const commit = events.find(e => e.type === 'recovery_checkpoint' && e.journal_sha256 === checksum);
    if (!commit) throw new Error('Journal has no durable commit event');
    const version = fs.realpathSync(path.resolve(source, commit.journal_file));
    if (!inside(source, version) || sha(version) !== checksum) throw new Error('Immutable recovery journal is missing or changed');
    if (Object.keys(journal.code_hashes).sort().join('|') !== [...sourceFiles].sort().join('|')) throw new Error('Incomplete recovery code inventory');
    for (const file of sourceFiles) if (sha(path.join(root, file)) !== journal.code_hashes[file]) throw new Error(`Implementation changed: ${file}`);
    for (const pointer of [journal.baseline, journal.best]) {
      const file = fs.realpathSync(pointer.checkpoint);
      if (!inside(source, file) || sha(file) !== pointer.sha256) throw new Error('Recovery DCP changed or escapes source run');
    }
    if (!Array.isArray(journal.completed_attempts) || !Array.isArray(journal.plan.ordered_plays)) throw new Error('Invalid committed history or plan');
    const plays = new Set(['route_explore','route_aggressive','route_more_global','rebuild_route','replace_explore','replace_timing','replace_netdelay']);
    if (journal.plan.ordered_plays.some(p => !plays.has(p)) || new Set(journal.plan.ordered_plays).size !== journal.plan.ordered_plays.length) throw new Error('Unknown or duplicate recovery recipe');
    const finished = new Set();
    for (const attempt of journal.completed_attempts) {
      if (!journal.plan.ordered_plays.includes(attempt.play) || finished.has(attempt.play) || !['accepted','rejected','failed'].includes(attempt.status) ||
          typeof attempt.accepted !== 'boolean' || !Number.isFinite(attempt.duration_seconds) || attempt.duration_seconds < 0) throw new Error('Invalid completed candidate');
      finished.add(attempt.play);
    }
  } catch (error) { issues.push(error.message); }
  return { ready: issues.length === 0, issues, warnings, source_directory: source || null,
    ...(issues.length ? {} : { journal_sha256: checksum, journal,
      remaining_plays: journal.plan.ordered_plays.filter(p => !journal.completed_attempts.some(a => a.play === p)),
      source_run_id: manifest.run_id }),
    boundary: 'New run from a committed boundary; original evidence remains untouched. Both baseline and selected DCP are remeasured before continuation.' };
}
