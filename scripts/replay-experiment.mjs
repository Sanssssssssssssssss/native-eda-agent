// Verify captured inputs before invoking the same native tool. Never restores files in place.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { verifyInputEvidence, traceContext } from '../src/trace.mjs';

const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function checkReplay(manifestPath, workspace) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const issues = [];
  const directory = path.dirname(path.resolve(manifestPath));
  const args = manifest.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) issues.push('Missing or invalid tool arguments.');
  else if (manifest.tool === 'eda_xsim' && (!Array.isArray(args.sources) || !args.sources.length || args.sources.some(s => typeof s !== 'string') || typeof args.top !== 'string' || !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(args.top))) issues.push('Invalid XSim arguments.');
  else if (manifest.tool === 'eda_vivado' && typeof args.script !== 'string') issues.push('Missing Vivado script.');
  else if (manifest.tool === 'eda_ltspice_batch' && typeof args.netlist !== 'string') issues.push('Missing SPICE netlist.');
  if (manifest.schema_version !== 1 || !['eda_xsim', 'eda_vivado', 'eda_ltspice_batch', 'eda_verify'].includes(manifest.tool)) issues.push('Unsupported native-tool manifest.');
  if (manifest.status === 'running') issues.push('Original run has no terminal state.');
  if (manifest.input_drift) issues.push('Inputs changed during the original run.');
  if (!Array.isArray(manifest.inputs) || !manifest.inputs.length) issues.push('No valid captured input list.');
  if (manifest.unresolved_dependencies?.length) issues.push(`${manifest.unresolved_dependencies.length} unresolved dependencies require review.`);
  if (path.resolve(manifest.workspace || '') !== path.resolve(workspace)) issues.push('Workspace relocation requires an explicit path-mapping review.');
  const integrity = verifyInputEvidence(manifest, directory, { checkCurrent: true, workspace });
  issues.push(...integrity.issues);
  if (manifest.snapshot_integrity?.valid === false) issues.push('Original run recorded invalid snapshot integrity.');
  return { ready: issues.length === 0, issues, manifest,
    integrity,
    boundary: 'Checks captured files only. Static discovery is incomplete; installed EDA versions, licenses and external state need separate confirmation. A rerun is a new experiment, not guaranteed bit-identical output.' };
}

async function main() {
  const [input, action = '--check-only'] = process.argv.slice(2);
  if (!input || !['--check-only', '--run'].includes(action)) throw new Error('Usage: node scripts/replay-experiment.mjs RUN_JSON [--check-only|--run]');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const checked = checkReplay(input, root);
  console.log(JSON.stringify({ ready: checked.ready, issues: checked.issues, boundary: checked.boundary }, null, 2));
  if (!checked.ready) { process.exitCode = 1; return; }
  if (action !== '--run') return;
  const directory = path.join(root, 'artifacts', `replay-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  fs.mkdirSync(directory);
  const argsFile = path.join(directory, 'arguments.json');
  fs.writeFileSync(argsFile, JSON.stringify(checked.manifest.arguments, null, 2));
  const record = { original_run_id: checked.manifest.run_id, original_manifest: path.resolve(input),
    original_manifest_sha256: sha(input), started_at: new Date().toISOString(), status: 'running',
    command: [process.execPath, 'scripts/eda-tool.mjs', checked.manifest.tool, argsFile],
    verification_boundary: checked.boundary, other_model_api_calls: 0 };
  const save = () => fs.writeFileSync(path.join(directory, 'replay.json'), JSON.stringify(record, null, 2));
  save();
  const out = fs.openSync(path.join(directory, 'stdout.log'), 'w');
  const err = fs.openSync(path.join(directory, 'stderr.log'), 'w');
  try {
    const code = await new Promise((resolve, reject) => {
      const inherited = traceContext(checked.manifest.context).context;
      const child = spawn(record.command[0], record.command.slice(1), { cwd: root, windowsHide: true, stdio: ['ignore', out, err],
        env: { ...process.env, ...Object.fromEntries(Object.entries(inherited).map(([key, value]) => [`EDA_TRACE_${key.toUpperCase()}`, value])),
          EDA_TRACE_PARENT_RUN_ID: checked.manifest.run_id, EDA_TRACE_TRACE_ID: checked.manifest.trace_id || '', EDA_TRACE_PARENT_SPAN_ID: checked.manifest.span_id || '' } });
      child.once('error', reject);
      child.once('close', resolve);
    });
    record.exit_code = code;
    record.status = code === 0 ? 'tool_completed_acceptance_separate' : 'tool_failed';
    process.exitCode = code === 0 ? 0 : 1;
  } catch (error) {
    record.status = 'launch_failed'; record.error = String(error); process.exitCode = 1;
  } finally {
    fs.closeSync(out); fs.closeSync(err);
    record.finished_at = new Date().toISOString(); save();
  }
  console.log(`Replay evidence: ${directory}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
