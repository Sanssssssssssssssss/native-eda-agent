// Read-only accounting and review plans. No deletion or migration operation is implemented.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const waveExtensions = new Set(['.wdb', '.vcd', '.fst', '.raw', '.wlf', '.fsdb', '.ghw']);
const reviewWaveExtensions = new Set(['.wdb', '.vcd', '.fst', '.wlf', '.fsdb', '.ghw']);
const slash = value => value.split(path.sep).join('/');

export function inventoryArtifacts(root, { includeFiles = false } = {}) {
  root = fs.realpathSync(root);
  const files = [];
  const errors = [];
  const skipped = [];
  const directories = new Map();
  const seen = new Set();
  let logical = 0, unique = 0, waveform = 0, inputLogical = 0, objectBytes = 0;
  function walk(directory) {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch (error) { errors.push({ path: path.relative(root, directory), code: error.code }); return; }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      const relative = slash(path.relative(root, file));
      try {
        const stat = fs.lstatSync(file, { bigint: true });
        if (stat.isSymbolicLink()) { skipped.push(relative); continue; }
        if (stat.isDirectory()) { walk(file); continue; }
        if (!stat.isFile()) continue;
        const bytes = Number(stat.size);
        const identity = stat.ino === 0n ? file : `${stat.dev}:${stat.ino}`;
        const key = relative.includes('/') ? relative.split('/')[0] : '(root files)';
        const row = directories.get(key) || { directory: key, logical_bytes: 0, files: 0, waveform_bytes: 0 };
        row.logical_bytes += bytes; row.files++;
        const isWave = waveExtensions.has(path.extname(file).toLowerCase());
        if (isWave) { row.waveform_bytes += bytes; waveform += bytes; }
        directories.set(key, row);
        logical += bytes;
        if (!seen.has(identity)) { seen.add(identity); unique += bytes; }
        if (/(^|\/)inputs\//.test(relative)) inputLogical += bytes;
        if (/(^|\/)\.trace-objects\/sha256\//.test(relative) && /^[a-f0-9]{64}$/.test(entry.name)) objectBytes += bytes;
        files.push({ path: relative, bytes, waveform: isWave, modified_at: new Date(Number(stat.mtimeMs)).toISOString(), identity, hardlinks: Number(stat.nlink) });
      } catch (error) { errors.push({ path: relative, code: error.code }); }
    }
  }
  walk(root);
  return { schema_version: 1, observed_at: new Date().toISOString(), root, read_only: true,
    scope: 'Only the requested tree; symbolic links are not followed. File sizes are logical, not allocated disk clusters.',
    file_count: files.length, logical_bytes: logical, hardlink_unique_bytes: unique, hardlink_saved_bytes: logical - unique,
    input_snapshot_logical_bytes: inputLogical, object_store_logical_bytes: objectBytes,
    waveform_bytes: waveform, waveform_fraction: logical ? waveform / logical : 0,
    disk_allocated_bytes: null, content_dedup_potential_bytes: null,
    directories: [...directories.values()].sort((a, b) => b.logical_bytes - a.logical_bytes),
    skipped_symlinks: skipped, errors, ...(includeFiles ? { files } : {}) };
}

export function retentionPlan(inventory, { minimumAgeDays = 7, now = Date.now() } = {}) {
  if (!Array.isArray(inventory.files)) throw new Error('Retention planning requires inventoryArtifacts(root, { includeFiles: true }).');
  if (!Number.isFinite(minimumAgeDays) || minimumAgeDays < 0) throw new Error('minimumAgeDays must be nonnegative.');
  const root = path.resolve(inventory.root);
  const candidates = [];
  const protectedCounts = {};
  const metadata = new Map();
  const owner = file => {
    let directory = path.dirname(file);
    const visited = [];
    while (directory === root || directory.startsWith(root + path.sep)) {
      if (metadata.has(directory)) {
        const value = metadata.get(directory); visited.forEach(item => metadata.set(item, value)); return value;
      }
      visited.push(directory);
      const manifest = path.join(directory, 'run.json');
      if (fs.existsSync(manifest)) {
        let value;
        try {
          value = JSON.parse(fs.readFileSync(manifest, 'utf8'));
          const policy = path.join(directory, 'retention.json');
          value = { run_id: value.run_id, status: value.status, finished_at: value.finished_at,
            pinned: Boolean(value.retention?.pinned || (fs.existsSync(policy) && JSON.parse(fs.readFileSync(policy, 'utf8')).pinned)),
            input_drift: Boolean(value.input_drift), invalid_snapshots: value.snapshot_integrity?.valid === false };
        } catch { value = { status: 'unreadable_manifest' }; }
        visited.forEach(item => metadata.set(item, value)); return value;
      }
      if (directory === root) break;
      directory = path.dirname(directory);
    }
    const value = { status: 'legacy_or_unknown' };
    visited.forEach(item => metadata.set(item, value)); return value;
  };
  for (const file of inventory.files) {
    if (!file.waveform) continue;
    const run = owner(path.join(root, file.path));
    const age = (now - Date.parse(run.finished_at || file.modified_at)) / 86400000;
    let reason;
    if (!reviewWaveExtensions.has(path.extname(file.path).toLowerCase())) reason = 'analog_raw_measurement_evidence';
    else if (run.pinned) reason = 'pinned';
    else if (run.status !== 'completed') reason = `preserve_${run.status || 'unknown'}`;
    else if (run.input_drift || run.invalid_snapshots) reason = 'integrity_or_drift_evidence';
    else if (!Number.isFinite(age) || age < minimumAgeDays) reason = 'recent';
    if (reason) { protectedCounts[reason] = (protectedCounts[reason] || 0) + file.bytes; continue; }
    candidates.push({ path: file.path, bytes: file.bytes, run_id: run.run_id, age_days: Math.round(age * 10) / 10,
      reason: 'Old completed run waveform; confirm functional acceptance and diagnostic value before any separate action.', action: 'review_only' });
  }
  candidates.sort((a, b) => b.bytes - a.bytes);
  return { schema_version: 1, created_at: new Date(now).toISOString(), root, mode: 'plan_only', deletes_files: false,
    minimum_age_days: minimumAgeDays, candidate_count: candidates.length, candidate_logical_bytes: candidates.reduce((sum, item) => sum + item.bytes, 0),
    protected_waveform_bytes_by_reason: protectedCounts, candidates,
    always_preserve: ['failed, timed-out, cancelled, running, pinned and unclassified legacy runs', 'input snapshots and content objects', 'events, manifests, receipts, process logs, reports, constraints, checkpoints and analog raw measurements'],
    future_default: 'Disable full waveform capture for new runs. Enable bounded signals and time windows for a concrete diagnostic question.' };
}

function markdown(report) {
  const inventory = report.inventory || report;
  const lines = ['# Artifact storage inventory', '', `Observed: ${inventory.observed_at}`, '',
    `Logical bytes: **${inventory.logical_bytes}**; unique bytes after hard-link accounting: **${inventory.hardlink_unique_bytes}**; saved by hard links: **${inventory.hardlink_saved_bytes}**.`,
    `Waveforms: **${inventory.waveform_bytes} bytes (${(inventory.waveform_fraction * 100).toFixed(2)}%)**. Allocated disk usage was not measured.`, '',
    '| Directory | Logical bytes | Waveform bytes | Files |', '|---|---:|---:|---:|',
    ...inventory.directories.slice(0, 20).map(row => `| ${row.directory} | ${row.logical_bytes} | ${row.waveform_bytes} | ${row.files} |`), '',
    `Read errors: ${inventory.errors.length}; skipped symbolic links: ${inventory.skipped_symlinks.length}.`];
  if (report.retention_plan) lines.push('', `Retention plan: ${report.retention_plan.candidate_count} review candidates, ${report.retention_plan.candidate_logical_bytes} logical bytes. No deletion operation exists.`, '', report.retention_plan.future_default);
  return lines.join('\n') + '\n';
}

function main() {
  const args = process.argv.slice(2);
  let root = path.resolve(import.meta.dirname, '../artifacts'), format = 'json', output, plan = false, days = 7;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--root') root = path.resolve(args.shift());
    else if (arg === '--format') format = args.shift();
    else if (arg === '--output') output = args.shift();
    else if (arg === '--plan') plan = true;
    else if (arg === '--minimum-age-days') days = Number(args.shift());
    else throw new Error('Usage: node scripts/artifact-inventory.mjs [--root artifacts] [--plan] [--minimum-age-days 7] [--format json|md] [--output FILE]');
  }
  if (!['json', 'md'].includes(format)) throw new Error('format must be json or md');
  const inventory = inventoryArtifacts(root, { includeFiles: plan });
  const report = plan ? { inventory: { ...inventory, files: undefined }, retention_plan: retentionPlan(inventory, { minimumAgeDays: days }) } : inventory;
  const text = format === 'md' ? markdown(report) : JSON.stringify(report, null, 2) + '\n';
  if (output) { fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(output, text); console.log(`Inventory saved: ${path.resolve(output)}`); }
  else process.stdout.write(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
