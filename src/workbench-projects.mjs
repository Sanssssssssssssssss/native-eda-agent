// Read-only project inventory. File presence and retained verification are separate facts.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectWorkflow} from './workflow.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = value => value.replaceAll('\\', '/');
const error = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
const LIMITS = Object.freeze({projects: 80, files_per_project: 400, directory_entries: 12000, depth: 5, file_bytes: 1024 * 1024, project_bytes: 16 * 1024 * 1024, preview_lines: 240, preview_bytes: 64 * 1024, workflow_runs: 80, cache_ttl_ms: 2000});
const DOMAINS = ['functional', 'synthesis', 'setup', 'hold', 'constraints', 'routing', 'cdc', 'drc', 'formal', 'hardware'];
const RTL = new Set(['.v', '.sv', '.vh', '.svh', '.vhd', '.vhdl']);
const TEXT = new Set([...RTL, '.xdc', '.sdc', '.tcl', '.json', '.md', '.py', '.mjs', '.c', '.h', '.s', '.ld', '.cir', '.xpr', '.hex', '.mem', '.mif', '.coe', '.txt']);
const PRIVATE = /^(?:auth|credentials?|secrets?|tokens?|api[_-]?keys?|passwords?|config|settings|messages|conversation|sessions?|prompt)(?:[._-]|$)/i;
const SKIP = /^(?:\.git|\.eda-state|\.pi|node_modules|runtime|artifacts|vendor|Gameboy|__pycache__|build|dist|out|output|reports|checkpoints|diagnostics|\.Xil)$/i;
const GENERATED = /\.(?:cache|runs|sim|gen|hw|ip_user_files|srcs)$/i;
const cache = new Map();
const within = (base, target) => {const rel = path.relative(base, target); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));};
const validRelative = name => typeof name === 'string' && name.length > 0 && name.length < 2048 && !/[\\:\x00-\x1f]/.test(name) && !name.startsWith('/') && name.split('/').every(p => p && p !== '.' && p !== '..' && !p.startsWith('.'));

// Reject links at every component, including junctions inside an approved directory.
function safePath(root, relative, {directory = false} = {}) {
  if (!validRelative(relative)) throw error('Expected a workspace-relative project path', 403);
  const base = fs.realpathSync(root);
  let current = base;
  for (const component of relative.split('/')) {
    current = path.join(current, component);
    if (fs.lstatSync(current).isSymbolicLink()) throw error('Linked project files are not available', 403);
  }
  const actual = fs.realpathSync(current), stat = fs.statSync(actual);
  if (!within(base, actual)) throw error('Project path escapes workspace', 403);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw error('Unexpected project file type');
  return {file: actual, stat};
}
function bytesAt(root, relative, limit = LIMITS.file_bytes) {
  const {file, stat} = safePath(root, relative);
  if (stat.size > limit) throw error('Project file exceeds preview size limit', 413);
  const bytes = fs.readFileSync(file);
  if (bytes.length > limit) throw error('Project file exceeds preview size limit', 413);
  return {bytes, stat};
}
function jsonAt(root, relative, limit) {return JSON.parse(bytesAt(root, relative, limit).bytes.toString('utf8'));}
function maybeJson(root, relative, limit) {try {return jsonAt(root, relative, limit);} catch {return null;}}
function decoded(bytes) {
  if (bytes.includes(0)) throw error('Binary or UTF-16 files cannot be edited in the source viewer', 415);
  try {return new TextDecoder('utf-8', {fatal: true}).decode(bytes);} catch {throw error('Source viewer requires valid UTF-8', 415);}
}
function sourceLines(text) {const lines = text.split(/\r?\n/); if (text.endsWith('\n')) lines.pop(); return lines.length ? lines : [''];}
function kindOf(relative) {
  const ext = path.posix.extname(relative).toLowerCase(), name = path.posix.basename(relative);
  if (RTL.has(ext)) return /(?:^|[/_.-])(?:tb|testbench|test|tests|sim)(?:[/_.-]|$)/i.test(relative) ? 'testbench' : 'rtl';
  if (['.xdc', '.sdc'].includes(ext) || /constraints?\.tcl$/i.test(name)) return 'constraint';
  if (ext === '.cir') return 'analog';
  if (['.hex', '.mem', '.mif', '.coe'].includes(ext)) return 'test_data';
  if (ext === '.md') return 'documentation';
  if (['.c', '.h', '.s', '.ld'].includes(ext)) return 'firmware';
  if (['.json', '.xpr'].includes(ext)) return 'metadata';
  return 'script';
}
function allowedFile(relative) {return validRelative(relative) && TEXT.has(path.posix.extname(relative).toLowerCase()) && !relative.split('/').some(p => PRIVATE.test(p));}
function moduleNames(text, extension) {
  // A lexical aid only: no macro expansion, include resolution, elaboration or hierarchy inference.
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, s => s.replace(/[^\r\n]/g, ' ')).replace(/\/\/[^\r\n]*|"(?:\\.|[^"\\])*"/g, s => ' '.repeat(s.length));
  const pattern = /\.vhd(?:l)?$/i.test(extension) ? /^[ \t]*entity\s+(\w+)\s+is\b/gim : /\bmodule\s+(?:(?:automatic|static)\s+)?([A-Za-z_$][\w$]*)/g;
  return [...stripped.matchAll(pattern)].slice(0, 120).map(m => ({name: m[1], line: stripped.slice(0, m.index).split('\n').length}));
}
function entries(root, relative, budget) {
  try {
    const dir = safePath(root, relative, {directory: true}).file;
    const result = [];
    // opendir bounds observation even when a generated directory has millions of entries.
    const stream = fs.opendirSync(dir);
    try {let entry; while ((entry = stream.readSync())) {if (++budget.visited > LIMITS.directory_entries) {budget.truncated = true; break;} result.push(entry);}} finally {stream.closeSync();}
    return result.sort((a, b) => a.name.localeCompare(b.name));
  } catch {return [];}
}
function discover(root) {
  const found = [], budget = {visited: 0, truncated: false};
  const walk = (relative, depth = 0) => {
    if (found.length >= LIMITS.projects || budget.truncated || depth > 3) {budget.truncated = true; return;}
    try {safePath(root, relative, {directory: true});} catch {return;}
    const children = entries(root, relative, budget).filter(e => !e.isSymbolicLink() && !e.name.startsWith('.') && !SKIP.test(e.name) && !GENERATED.test(e.name));
    const hasDesign = children.some(e => e.isFile() && (RTL.has(path.extname(e.name).toLowerCase()) || ['sources.json', 'selection.json'].includes(e.name) || /\.xpr$/i.test(e.name))) || children.some(e => e.isDirectory() && /^(?:rtl|solutions)$/i.test(e.name));
    if (hasDesign || relative === 'examples/analog') {found.push(relative); return;}
    for (const entry of children) if (entry.isDirectory()) walk(`${relative}/${entry.name}`, depth + 1);
  };
  for (const entry of entries(root, 'projects', budget)) if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.') && !SKIP.test(entry.name)) walk(`projects/${entry.name}`);
  for (const relative of ['examples/digital', 'examples/analog']) walk(relative);
  return {paths: found, truncated: budget.truncated};
}
const projectId = relative => `${path.posix.basename(relative).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48)}-${sha(relative).slice(0, 10)}`;
function projectPath(root, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(id)) throw error('Invalid project identifier');
  const relative = discover(root).paths.find(p => projectId(p) === id);
  if (!relative) throw error('Project not found', 404);
  return relative;
}
function collect(root, relative) {
  const files = [], omitted = [], budget = {visited: 0, truncated: false}, references = new Set();
  let bytesRead = 0;
  const add = (publicPath, dependency = false) => {
    if (files.length >= LIMITS.files_per_project || bytesRead >= LIMITS.project_bytes) {budget.truncated = true; return;}
    if (!allowedFile(publicPath) || files.some(f => f.publicPath === publicPath)) return;
    const local = dependency ? `@dependencies/${publicPath}` : publicPath.slice(relative.length + 1);
    try {
      const {bytes, stat} = bytesAt(root, publicPath); bytesRead += bytes.length;
      if (bytesRead > LIMITS.project_bytes) {budget.truncated = true; return;}
      let text = null;
      try {text = decoded(bytes);} catch { /* Inventory may list an unpreviewable file without decoding it. */ }
      const kind = kindOf(local), modules = text !== null && ['rtl', 'testbench'].includes(kind) ? moduleNames(text, path.extname(publicPath)) : [];
      const file = {path: local, publicPath, kind, bytes: bytes.length, sha256: sha(bytes), lines: text === null ? null : sourceLines(text).length,
        modules, dependency, editable: !dependency && kind === 'rtl' && text !== null && bytes.length > 0, previewable: text !== null, modified_at: stat.mtime.toISOString()};
      files.push(file);
      if (!dependency && kind === 'metadata' && text !== null) {
        try {const data = JSON.parse(text); for (const name of [...(Array.isArray(data.sources) ? data.sources : []), ...(Array.isArray(data.constraints) ? data.constraints : [])]) if (typeof name === 'string' && /^(?:vendor|projects|examples\/digital)\//.test(name) && allowedFile(name)) references.add(name);} catch { /* Project metadata does not have to be JSON. */ }
      }
    } catch (e) {omitted.push({publicPath, reason: e.statusCode === 413 ? 'size_limit' : 'unavailable_or_unsafe'});}
  };
  const walk = (dir, depth = 0) => {
    if (depth > LIMITS.depth || budget.truncated) {budget.truncated = true; return;}
    for (const entry of entries(root, dir, budget)) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || SKIP.test(entry.name) || GENERATED.test(entry.name) || PRIVATE.test(entry.name)) continue;
      const candidate = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(candidate, depth + 1);
      else if (entry.isFile()) add(candidate);
      if (files.length >= LIMITS.files_per_project || bytesRead >= LIMITS.project_bytes) {budget.truncated = true; break;}
    }
  };
  walk(relative);
  // The task specification may bind a fixed checker or XDC outside the design folder.
  // Capture those explicit inputs as immutable dependencies rather than silently omitting them.
  const specPaths = new Set(files.filter(f => !f.dependency && f.kind === 'metadata').map(f => f.publicPath));
  for (const entry of entries(root, 'examples/workflows', budget)) if (entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.json')) specPaths.add(`examples/workflows/${entry.name}`);
  for (const name of specPaths) {
    const spec = maybeJson(root, name);
    if (spec?.schema_version !== 1 || !Array.isArray(spec.steps) || !Array.isArray(spec.inputs)) continue;
    const declared = [...spec.inputs, ...spec.steps.flatMap(s => [...(Array.isArray(s.args?.sources) ? s.args.sources : []), ...(Array.isArray(s.args?.constraints) ? s.args.constraints : [])])];
    if (!declared.some(p => typeof p === 'string' && p.startsWith(relative + '/'))) continue;
    for (const input of [name, ...declared]) {
      if (typeof input !== 'string') continue;
      if (/^(?:vendor|projects|examples)\//.test(input) && allowedFile(input)) references.add(input);
      else omitted.push({publicPath: input, reason: 'unsupported_declared_workflow_input'});
    }
  }
  for (const name of references) add(name, !name.startsWith(relative + '/'));
  files.sort((a, b) => a.dependency - b.dependency || a.path.localeCompare(b.path));
  const counts = {rtl: 0, local_rtl: 0, testbench: 0, constraint: 0, test_data: 0, modules: 0, rtl_modules: 0, testbench_modules: 0, files: files.length, dependencies: 0};
  for (const f of files) {if (Object.hasOwn(counts, f.kind)) counts[f.kind]++; counts.modules += f.modules.length; if (f.kind === 'rtl') counts.rtl_modules += f.modules.length; if (f.kind === 'testbench') counts.testbench_modules += f.modules.length; if (f.dependency) counts.dependencies++; else if (f.kind === 'rtl') counts.local_rtl++;}
  return {files, counts, omitted, inventory_truncated: budget.truncated, digest: sha(JSON.stringify(files.map(f => [f.publicPath, f.sha256]))), last_modified: files.map(f => f.modified_at).sort().at(-1) || null};
}
function workflows(root, project, files) {
  const paths = new Set(files.filter(f => !f.dependency && f.kind === 'metadata').map(f => f.publicPath));
  const budget = {visited: 0};
  for (const e of entries(root, 'examples/workflows', budget)) if (e.isFile() && !e.isSymbolicLink() && e.name.endsWith('.json')) paths.add(`examples/workflows/${e.name}`);
  const rows = [];
  for (const name of paths) {
    const spec = maybeJson(root, name);
    if (spec?.schema_version !== 1 || !Array.isArray(spec.steps) || !Array.isArray(spec.inputs)) continue;
    const bound = [...spec.inputs, ...spec.steps.flatMap(s => [...(Array.isArray(s.args?.sources) ? s.args.sources : []), ...(Array.isArray(s.args?.constraints) ? s.args.constraints : [])])];
    if (!bound.some(p => typeof p === 'string' && p.startsWith(project + '/'))) continue;
    rows.push({id: spec.id, path: name, goal: spec.goal, domains: Object.keys(spec.acceptance?.bindings || {}), steps: spec.steps.map(s => ({id: s.id, tool: s.tool})),
      top: spec.acceptance?.design?.top || spec.steps.find(s => s.tool === 'eda_vivado_synthesize')?.args?.top || null,
      simulation_top: spec.steps.find(s => s.tool === 'eda_xsim')?.args?.top || null, part: spec.acceptance?.design?.part || spec.steps.find(s => s.args?.part)?.args.part || null,
      clock: spec.acceptance?.design?.clock || null, period_ns: spec.acceptance?.design?.period_ns || null});
  }
  return rows;
}
function evidenceDirectory(root, value) {
  if (typeof value !== 'string') return null;
  const relative = path.isAbsolute(value) ? slash(path.relative(fs.realpathSync(root), value)) : slash(value);
  if (!/^artifacts\/[A-Za-z0-9._-]+$/.test(relative)) return null;
  try {safePath(root, relative, {directory: true}); return relative;} catch {return null;}
}
function workflowEvidence(root, directory) {
  const manifest = maybeJson(root, `${directory}/run.json`, 4 * 1024 * 1024);
  if (!manifest) return null;
  const base = {id: path.posix.basename(directory), tool: manifest.tool || manifest.mode || 'unknown', status: manifest.status || 'unknown', started_at: manifest.started_at || manifest.startedAt || null, workflow: true, requested_domains: null, acceptance: null, integrity: 'unknown', current_inputs: 'unknown', scope: 'historical', issues: []};
  try {
    const inspected = inspectWorkflow(root, directory), state = inspected.state;
    base.requested_domains = state.plan.acceptance?.required || [];
    const outcome = jsonAt(root, `${directory}/task-outcome.json`);
    const outcomeHash = sha(bytesAt(root, `${directory}/task-outcome.json`).bytes);
    const evidenceIssues = inspected.issues.filter(x => !/^(?:input_changed|input_missing|input_binding_changed|include_contents_changed|implementation_changed)/.test(x));
    base.integrity = state.task_acceptance_hash && state.task_acceptance_hash === outcomeHash && evidenceIssues.length === 0 ? 'match' : 'mismatch';
    base.current_inputs = inspected.issues.some(x => /^(?:input_|include_contents)/.test(x)) ? 'mismatch' : 'match';
    base.scope = inspected.valid && base.integrity === 'match' ? 'current' : 'historical';
    base.issues = inspected.issues;
    if (base.integrity === 'match') base.acceptance = {status: outcome.status, domains: outcome.domains || []};
    base.input_paths = Object.keys(state.plan.input_hashes || {});
    base.spec_path = state.plan.spec_path;
  } catch (e) {base.integrity = 'unavailable'; base.issues = ['Workflow evidence could not be verified'];}
  return base;
}
function linkedRuns(root, project, files, specs) {
  const selected = new Map(), specPaths = new Set(specs.map(s => s.path));
  // Legacy project pointers are observed receipts only; a pass field cannot confer acceptance.
  for (const f of files.filter(f => !f.dependency && /^latest[-_].*\.json$/i.test(path.posix.basename(f.path)))) {
    const value = maybeJson(root, f.publicPath), dir = evidenceDirectory(root, value?.artifact_directory || value?.directory);
    if (!dir) continue;
    const m = maybeJson(root, `${dir}/run.json`, 4 * 1024 * 1024);
    selected.set(path.posix.basename(dir), {id: path.posix.basename(dir), tool: m?.tool || value.stage || 'legacy_run', status: m?.status || (value.pass === true ? 'recorded_pass' : value.pass === false ? 'recorded_fail' : 'unknown'), started_at: m?.started_at || value.started_at_utc || null,
      acceptance: null, integrity: 'unbound_legacy_receipt', current_inputs: 'unknown', scope: 'historical', receipt: f.publicPath, receipt_sha256: f.sha256, issues: ['Historical pointer is not a current engineering acceptance contract']});
  }
  const budget = {visited: 0}, candidates = entries(root, 'artifacts', budget).filter(e => e.isDirectory() && !e.isSymbolicLink() && /^\d{4}-\d{2}-\d{2}T.*-eda_workflow_(?:run|resume)-/.test(e.name)).sort((a, b) => b.name.localeCompare(a.name)).slice(0, LIMITS.workflow_runs);
  for (const e of candidates) {
    const directory = `artifacts/${e.name}`, m = maybeJson(root, `${directory}/run.json`, 4 * 1024 * 1024);
    if (!m) continue;
    // Candidate flows may read original vectors or initialization files. Those
    // shared dependencies do not bind the candidate verdict to the original RTL.
    if (/(?:^|\/)artifacts\/agent-task-[^/]+\//.test(slash(m.arguments?.spec || ''))) continue;
    const mentionsProject = m.inputs?.some(i => typeof i.relative_path === 'string' && slash(i.relative_path).startsWith(project + '/'));
    if (!specPaths.has(m.arguments?.spec) && !mentionsProject) continue;
    const observed = workflowEvidence(root, directory);
    if (observed) selected.set(observed.id, observed);
  }
  return [...selected.values()].sort((a, b) => (b.started_at || b.id).localeCompare(a.started_at || a.id)).slice(0, 30);
}
const HISTORICAL = {
  'projects/fft-spectrum': ['fft-1024'], 'projects/verilogeval-mini': ['verilogeval-8-original'],
  'projects/verilogeval-24': ['verilogeval-24-original', 'verilogeval-24-extended'],
  'projects/system-bench': ['system-projects-4'], 'projects/hard-bench': ['hard-projects-3'],
};
function historicalResults(root, project) {
  const catalog = maybeJson(root, 'results/catalog.json');
  if (!Array.isArray(catalog?.records)) return [];
  const binding = Object.entries(HISTORICAL).find(([key]) => key === project || project.startsWith(key + '/'));
  if (!binding) return [];
  return catalog.records.filter(r => binding[1].includes(r.id)).map(r => ({id: r.id, title: r.title, scope: r.scope, unit: r.unit, passed: r.passed, total: r.total, recorded_on: r.recorded_on,
    project_scope: binding[0] === project ? 'project' : 'aggregate_not_project_specific', limitations: r.limitations,
    public_evidence_valid: Array.isArray(r.evidence) && r.evidence.length > 0 && r.evidence.every(e => {try {return /^results\/evidence\//.test(e.path) && sha(bytesAt(root, e.path, 4 * 1024 * 1024).bytes) === e.sha256;} catch {return false;}})}));
}
function matrix(runs) {
  return Object.fromEntries(DOMAINS.map(domain => {
    // New damaged or failed evidence must remain visible; do not fall back to an older pass.
    const run = runs.find(r => r.workflow && (r.requested_domains === null || r.requested_domains?.includes(domain)));
    const observed = run?.integrity === 'match' ? run.acceptance?.domains?.find(d => d.domain === domain) : null;
    return [domain, observed ? {...observed, scope: run.scope, run_id: run.id, recorded_at: run.started_at, integrity: run.integrity} : {status: 'unknown', scope: run?.scope || 'unknown', run_id: run?.id || null, recorded_at: run?.started_at || null, observed: null, evidence: null, integrity: run?.integrity || 'unknown', reason: run ? 'latest_evidence_unverified' : 'no_bound_evidence'}];
  }));
}
function summary(root, relative, inventory, specs, runs, historical) {
  const localRtl = inventory.files.filter(f => !f.dependency && f.kind === 'rtl');
  return {id: projectId(relative), title: path.posix.basename(relative).replaceAll('-', ' '), publicPath: relative, counts: inventory.counts,
    implementation: localRtl.length ? 'sources_present' : 'metadata_only', verification: Object.values(matrix(runs)).some(d => d.scope === 'current' && d.status === 'passed') ? 'current_evidence' : runs.length || historical.length ? 'historical' : 'unknown',
    digest: inventory.digest, last_modified: inventory.last_modified, latest_run: runs[0] || null, workflows: specs, inventory_truncated: inventory.inventory_truncated,
    truncated: inventory.inventory_truncated || inventory.omitted.length > 0};
}
export function listProjects(root) {
  const key = fs.realpathSync(root), saved = cache.get(key);
  if (saved && Date.now() - saved.time < LIMITS.cache_ttl_ms) return structuredClone(saved.value);
  const discovery = discover(key), projects = discovery.paths.map(relative => {
    const inventory = collect(key, relative), specs = workflows(key, relative, inventory.files), runs = linkedRuns(key, relative, inventory.files, specs), historical = historicalResults(key, relative);
    return summary(key, relative, inventory, specs, runs, historical);
  });
  const value = {schema_version: 1, observed_at: new Date().toISOString(), projects, truncated: discovery.truncated, limits: LIMITS,
    boundary: 'RTL files indicate implementation exists. Verification requires bound reports and input hashes. Historical aggregate scores are never assigned to individual modules.'};
  cache.set(key, {time: Date.now(), value});
  if (cache.size > 12) cache.delete(cache.keys().next().value);
  return structuredClone(value);
}
export function getProject(root, id) {
  const relative = projectPath(root, id), inventory = collect(root, relative), specs = workflows(root, relative, inventory.files), runs = linkedRuns(root, relative, inventory.files, specs), historical = historicalResults(root, relative);
  for (const file of inventory.files) file.evidence_links = runs.filter(r => r.integrity === 'match' && r.input_paths?.includes(file.publicPath)).map(r => ({run_id: r.id, scope: r.scope, status: r.acceptance?.status || 'unknown', domains: (r.acceptance?.domains || []).filter(d => !['not_requested', 'not_required'].includes(d.status)).map(d => ({domain: d.domain, status: d.status})),
    boundary: 'This source was an input of the declared design run. It is not an independent per-module proof.'}));
  return {schema_version: 1, observed_at: new Date().toISOString(), ...summary(root, relative, inventory, specs, runs, historical), files: inventory.files, omitted: inventory.omitted, runs, historical_results: historical, verification_matrix: matrix(runs),
    module_detection: 'Lexical module/entity names only. Macro expansion, elaboration, hierarchy and per-module correctness are not inferred.',
    inventory_scope: 'Enumerated source and test text files only. Generated build directories, hidden configuration and binary products are excluded; this inventory does not establish a standalone runnable clone.', limits: LIMITS};
}
export function readProjectSource(root, id, relative, {start_line = 1, line_count = 160} = {}) {
  if (!Number.isSafeInteger(start_line) || start_line < 1 || !Number.isSafeInteger(line_count) || line_count < 1 || line_count > LIMITS.preview_lines) throw error('Invalid source line range');
  const project = projectPath(root, id), inventory = collect(root, project);
  const selected = inventory.files.find(f => f.path === relative || f.publicPath === relative);
  if (!selected) throw error('File is outside the selected project inventory', 403);
  const {bytes} = bytesAt(root, selected.publicPath), text = decoded(bytes), lines = sourceLines(text);
  if (start_line > Math.max(1, lines.length)) throw error('Source line range is outside file');
  const page = []; let pageBytes = 0;
  for (let index = start_line - 1; index < Math.min(lines.length, start_line - 1 + line_count); index++) {
    const size = Buffer.byteLength(lines[index], 'utf8');
    if (pageBytes + size > LIMITS.preview_bytes) {if (!page.length) throw error('Source line exceeds preview page size', 413); break;}
    page.push({number: index + 1, text: lines[index]}); pageBytes += size;
  }
  const end = page.at(-1)?.number || start_line;
  return {project_id: id, path: selected.path, publicPath: selected.publicPath, sha256: sha(bytes), editable: selected.editable, kind: selected.kind, encoding: 'utf-8', total_lines: lines.length, start_line, end_line: end, lines: page, truncated: end < lines.length, next_line: end < lines.length ? end + 1 : null};
}
