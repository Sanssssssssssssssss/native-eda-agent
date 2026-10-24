import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import spawn from 'cross-spawn';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const now = () => new Date().toISOString();
const save = (file, value) => {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, file);
};
const forbidden = /(?:^|[\\/])(?:\.pi-state|\.git|node_modules)(?:[\\/]|$)|(?:^|[\\/])(?:auth\.json|credentials[^\\/]*|\.env(?:\.[^\\/]*)?)(?:$|[\\/])/i;
const digestPattern = /^[a-f0-9]{64}$/;
const contextFields = ['campaign_id', 'case_id', 'parent_run_id', 'session_id', 'thread_id', 'trace_id', 'parent_span_id'];
const isInside = (base, file) => {
  const relative = path.relative(base, file);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

export function traceContext(context = {}, env = process.env) {
  const selected = {};
  const invalid = [];
  for (const field of contextFields) {
    const value = context[field] ?? env[`EDA_TRACE_${field.toUpperCase()}`];
    if (value === undefined || value === '') continue;
    const pattern = field === 'trace_id' ? /^(?!0+$)[a-f0-9]{32}$/ : field === 'parent_span_id' ? /^(?!0+$)[a-f0-9]{16}$/ : /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
    if (typeof value === 'string' && pattern.test(value)) selected[field] = value;
    else invalid.push(field);
  }
  return { context: selected, invalid_context_fields: invalid };
}

// Publish complete immutable-by-convention bytes, never a hard link to the mutable source.
export function storeSnapshot(bytes, destination, objectRoot) {
  const digest = hash(bytes);
  const object = path.join(objectRoot, digest.slice(0, 2), digest);
  fs.mkdirSync(path.dirname(object), { recursive: true });
  const verify = () => {
    const info = fs.lstatSync(object);
    if (!info.isFile() || info.isSymbolicLink() || hash(fs.readFileSync(object)) !== digest) throw Object.assign(new Error(`Object integrity failure: ${object}`), { code: 'TRACE_INTEGRITY' });
  };
  if (!fs.existsSync(object)) {
    const temporary = `${object}.${process.pid}.${randomUUID()}.tmp`;
    const fd = fs.openSync(temporary, 'wx');
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try {
      try { fs.linkSync(temporary, object); }
      catch (error) {
        if (error.code === 'EEXIST') verify();
        else if (['EPERM', 'EACCES', 'ENOTSUP', 'EXDEV', 'ENOSYS'].includes(error.code)) {
          // Filesystems without hard links still get an atomic rename under an exclusive publication lock.
          const lock = `${object}.lock`;
          let lockFd;
          for (let attempt = 0; attempt < 100 && lockFd === undefined; attempt++) {
            try { lockFd = fs.openSync(lock, 'wx'); }
            catch (failure) {
              if (failure.code !== 'EEXIST') throw failure;
              if (fs.existsSync(object)) { verify(); break; }
              Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
            }
          }
          if (lockFd !== undefined) {
            try { if (fs.existsSync(object)) verify(); else fs.renameSync(temporary, object); }
            finally { fs.closeSync(lockFd); fs.unlinkSync(lock); }
          } else if (!fs.existsSync(object)) throw new Error(`Object publication lock busy: ${lock}`);
        } else throw error;
      }
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  verify();
  fs.chmodSync(object, 0o444);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  let storage = 'hardlink';
  try { fs.linkSync(object, destination); }
  catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP', 'EXDEV', 'ENOSYS', 'EMLINK'].includes(error.code)) throw error;
    fs.copyFileSync(object, destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, 0o444);
    storage = 'copy';
  }
  if (hash(fs.readFileSync(destination)) !== digest) throw Object.assign(new Error(`Snapshot integrity failure: ${destination}`), { code: 'TRACE_INTEGRITY' });
  return { sha256: digest, object, storage };
}

export function verifyInputEvidence(manifest, directory, { checkCurrent = false, workspace = manifest.workspace } = {}) {
  const issues = [];
  let checked = 0;
  const objects = new Set();
  const inspect = (file, expected, base, label, relative) => {
    try {
      const realBase = fs.realpathSync(base);
      const realFile = fs.realpathSync(file);
      if (!isInside(realBase, realFile)) throw new Error('unsafe path outside allowed directory');
      if (!fs.statSync(realFile).isFile()) throw new Error('not a regular file');
      if (hash(fs.readFileSync(realFile)) !== expected) issues.push(`${label} differs: ${relative}`);
      return fs.statSync(realFile, { bigint: true });
    } catch (error) { issues.push(`${label} missing or unsafe: ${relative} (${error.code || error.message})`); }
  };
  for (const input of Array.isArray(manifest.inputs) ? manifest.inputs : []) {
    if (!input || typeof input !== 'object' || typeof input.snapshot !== 'string' || typeof input.relative_path !== 'string' || !digestPattern.test(input.sha256 || '')) { issues.push('Malformed captured input.'); continue; }
    checked++;
    const snapshot = path.resolve(directory, input.snapshot);
    let snapStat;
    if (!isInside(path.resolve(directory), snapshot)) issues.push(`Unsafe snapshot path: ${input.relative_path}`);
    else snapStat = inspect(snapshot, input.sha256, directory, 'snapshot', input.relative_path);
    if (manifest.storage?.version === 1 && (input.object_path === undefined || input.object_sha256 === undefined)) issues.push(`Missing content object reference: ${input.relative_path}`);
    if (input.object_path !== undefined || input.object_sha256 !== undefined) {
      const objectRoot = path.resolve(directory, '..', '.trace-objects', 'sha256');
      const expected = path.join(objectRoot, input.sha256.slice(0, 2), input.sha256);
      const object = typeof input.object_path === 'string' ? path.resolve(directory, input.object_path) : '';
      if (object !== expected || input.object_sha256 !== input.sha256) issues.push(`Unsafe or malformed object reference: ${input.relative_path}`);
      else if (!objects.has(object)) { objects.add(object); inspect(object, input.sha256, objectRoot, 'object', input.relative_path); }
    }
    if (checkCurrent) {
      const current = path.resolve(workspace, input.relative_path);
      if (!isInside(path.resolve(workspace), current)) issues.push(`Unsafe current input path: ${input.relative_path}`);
      else {
        const currentStat = inspect(current, input.sha256, workspace, 'current input', input.relative_path);
        if (snapStat && currentStat && snapStat.ino !== 0n && snapStat.ino === currentStat.ino && snapStat.dev === currentStat.dev) issues.push(`Snapshot aliases mutable current input: ${input.relative_path}`);
      }
    }
  }
  return { valid: issues.length === 0, checked_inputs: checked, checked_objects: objects.size, issues };
}

export function validateTraceEvent(event, { expectedSeq, runId, requireSpans = event?.schema_version === 1 } = {}) {
  const issues = [];
  if (!event || typeof event !== 'object' || Array.isArray(event)) return ['Event must be an object.'];
  if (event.schema_version !== undefined && event.schema_version !== 1) issues.push('Unsupported event schema version.');
  if (!Number.isSafeInteger(event.seq) || event.seq < 1 || (expectedSeq !== undefined && event.seq !== expectedSeq)) issues.push('Invalid or discontinuous event sequence.');
  if (typeof event.timestamp_utc !== 'string' || !Number.isFinite(Date.parse(event.timestamp_utc))) issues.push('Missing or invalid event timestamp.');
  if (typeof event.type !== 'string' || !event.type) issues.push('Missing event type.');
  if (typeof event.run_id !== 'string' || !event.run_id || (runId && event.run_id !== runId)) issues.push('Missing or inconsistent run ID.');
  if (requireSpans) {
    if (!/^(?!0+$)[a-f0-9]{32}$/.test(event.trace_id || '')) issues.push('Invalid trace ID.');
    if (!/^(?!0+$)[a-f0-9]{16}$/.test(event.span_id || '')) issues.push('Invalid span ID.');
    if (event.parent_span_id !== null && !/^(?!0+$)[a-f0-9]{16}$/.test(event.parent_span_id || '')) issues.push('Invalid parent span ID.');
  }
  if (typeof event.type === 'string' && event.type.startsWith('process_') && (!Number.isSafeInteger(event.process_id) || event.process_id < 1)) issues.push('Invalid process ID.');
  if (event.pid !== undefined && event.pid !== null && (!Number.isSafeInteger(event.pid) || event.pid <= 0)) issues.push('Invalid operating-system PID.');
  if (event.exit_code !== undefined && event.exit_code !== null && !Number.isInteger(event.exit_code)) issues.push('Invalid exit code.');
  if (event.duration_ms !== undefined && (!Number.isFinite(event.duration_ms) || event.duration_ms < 0)) issues.push('Invalid duration.');
  if (event.type === 'process_start' && (typeof event.exe !== 'string' || !Array.isArray(event.args) || event.args.some(value => typeof value !== 'string') || typeof event.cwd !== 'string')) issues.push('Invalid process command fields.');
  if (event.type === 'process_end' && (typeof event.termination_reason !== 'string' || !Number.isFinite(Date.parse(event.ended_at)) || !Number.isFinite(event.duration_ms))) issues.push('Missing process terminal fields.');
  return issues;
}

export function mcpTraceContext(ctx = {}) {
  const meta = ctx.mcpReq?._meta || {};
  const parent = meta.traceparent || ctx.mcpReq?.envelope?.traceparent;
  const match = typeof parent === 'string' && /^00-([a-f0-9]{32})-([a-f0-9]{16})-[a-f0-9]{2}$/.exec(parent);
  const inherited = match && !/^0+$/.test(match[1]) && !/^0+$/.test(match[2]) ? {trace_id:match[1],parent_span_id:match[2]} : {};
  return {...inherited,...traceContext(meta['eda.trace'] || {},{}).context};
}

export function createTrace({ root, tool, args, toolCallId, context = {}, artifactRoot = path.join(root, 'artifacts') }) {
  root = fs.realpathSync(root);
  const id = `${now().replace(/[:.]/g, '-')}-${tool.replace(/[^\w-]/g, '_')}-${randomUUID().slice(0, 8)}`;
  const directory = path.join(artifactRoot, id);
  const objectRoot = path.join(artifactRoot, '.trace-objects', 'sha256');
  const association = traceContext(context);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'process.log'), '');
  let seq = 0;
  const start = performance.now();
  const known = new Map();
  const symbols = new Map();
  const pending = [];
  const manifest = {
    schema_version: 1, run_id: id, tool_call_id: toolCallId, tool, arguments: args,
    ...association, trace_id: association.context.trace_id || randomUUID().replaceAll('-', ''), span_id: randomUUID().replaceAll('-', '').slice(0, 16), parent_span_id: association.context.parent_span_id || null,
    directory, workspace: root, started_at: now(), finished_at: null, status: 'running',
    runtime: { node: process.version, platform: process.platform, arch: process.arch, os_release: os.release() },
    processes: [], inputs: [], unresolved_dependencies: [],
    storage: { version: 1, mode: 'content_addressed_inputs', object_store: path.relative(directory, objectRoot), snapshots: 'read_only_hardlinks_or_copies', integrity: 'SHA-256 verified on publication and inspection; read-only attributes are not a security boundary.' },
    retention: { pinned: false, preserve_core_evidence: true, failed_runs: 'preserve_all', policy_file: 'retention.json', automatic_deletion: false },
    input_execution: 'Original workspace paths; snapshots preserve captured bytes; start/end hashes detect drift.',
    dependency_discovery: 'Best-effort static literals, includes, file-join $root, and unambiguous string constants; runtime expressions and parameter overrides are not evaluated. Completeness is not guaranteed.',
    acceptance: 'not_evaluated_by_trace',
    usage: { other_model_api_calls: 0, scope: 'This native tool invocation only', outer_codex_tokens: null, outer_codex_cost: null },
  };
  const persist = () => save(path.join(directory, 'run.json'), manifest);
  const event = (type, details = {}) => {
    const processSpan = details.process_id && manifest.processes.find(item => item.process_id === details.process_id);
    const entry = { ...details, schema_version: 1, timestamp_utc: now(), seq: seq + 1, run_id: id, type,
      trace_id: manifest.trace_id, span_id: processSpan?.span_id || manifest.span_id, parent_span_id: processSpan ? manifest.span_id : manifest.parent_span_id };
    const problems = validateTraceEvent(entry, { expectedSeq: seq + 1, runId: id });
    if (problems.length) throw new Error(`Invalid trace event: ${problems.join(' ')}`);
    fs.appendFileSync(path.join(directory, 'events.jsonl'), JSON.stringify(entry) + '\n');
    seq++;
  };
  const unresolved = (from, expression, reason) => {
    const item = { from, expression, reason };
    if (!manifest.unresolved_dependencies.some(x => JSON.stringify(x) === JSON.stringify(item))) manifest.unresolved_dependencies.push(item);
  };
  const inside = file => {
    const relative = path.relative(root, file);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  };
  const resolveDependency = (value, from, role) => {
    const cleaned = value.replace(/\\\\/g, '\\');
    const includeRoots = role === 'verilog_include' && Array.isArray(args?.include_dirs) ? args.include_dirs.filter(value => typeof value === 'string').map(value => path.resolve(root, value)) : [];
    const options = path.isAbsolute(cleaned) ? [cleaned] : [path.resolve(path.dirname(from), cleaned), ...includeRoots.map(directory => path.join(directory, cleaned)), path.resolve(root, cleaned)];
    const candidate = options.find(file => fs.existsSync(file));
    if (candidate) capture(candidate, role, from);
    else unresolved(from, value, 'Referenced file was not found relative to its source or workspace.');
  };
  const inspect = (file, content) => {
    const extension = path.extname(file).toLowerCase();
    if (['.v', '.sv', '.vh', '.svh'].includes(extension)) {
      for (const match of content.matchAll(/\b(?:parameter|localparam)\s+(?:\w+\s+)?(\w+)\s*=\s*"([^"\r\n]+)"/g)) {
        const definitions = symbols.get(match[1]) || [];
        definitions.push({ value: match[2], file });
        symbols.set(match[1], definitions);
      }
      for (const match of content.matchAll(/^\s*`include\s+"([^"\r\n]+)"/gm)) resolveDependency(match[1], file, 'verilog_include');
      for (const match of content.matchAll(/\$(?:readmemh|readmemb|fopen)\s*\(\s*("[^"\r\n]+"|[^,\)\r\n]+)/g)) {
        const expression = match[1].trim();
        if (expression.startsWith('"')) resolveDependency(expression.slice(1, -1), file, 'simulation_data');
        else pending.push({ file, expression });
      }
    } else if (extension === '.tcl') {
      for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:source|read_verilog|read_vhdl|read_xdc|read_ip|read_mem|add_files)\s+(.+)/);
        if (!match) continue;
        const body = match[1].trim();
        const join = body.match(/\[file\s+join\s+\$root\s+([^\]]+)\]/);
        if (join && !/[\$\[\]{}"]/.test(join[1])) resolveDependency(path.join(root, ...join[1].trim().split(/\s+/)), file, 'tcl_dependency');
        else {
          const literal = body.replace(/^(?:-\w+\s+)*/, '').match(/^(?:"([^"$\[\]]+)"|\{([^{}$\[\]]+)\}|([^\s$\[\]{}"]+))\s*(?:#.*)?$/);
          if (literal) resolveDependency(literal[1] || literal[2] || literal[3], file, 'tcl_dependency');
          else unresolved(file, body, 'Computed or unsupported Tcl dependency; no Tcl is executed during snapshotting.');
        }
      }
    } else if (['.cir', '.net', '.lib', '.sub'].includes(extension)) {
      for (const match of content.matchAll(/^\s*\.(?:include|inc|lib)\s+(?:"([^"]+)"|(\S+))/gim)) resolveDependency(match[1] || match[2], file, 'spice_dependency');
    }
  };
  function capture(value, role = 'input', from = null) {
    let file;
    try {
      file = fs.realpathSync(path.resolve(root, value));
      if (!inside(file) || forbidden.test(path.relative(root, file))) {
        unresolved(from, value, 'Outside workspace or excluded credential/runtime directory.');
        return;
      }
      if (known.has(file.toLowerCase())) return;
      if (!fs.statSync(file).isFile()) { unresolved(from, value, 'Not a regular file.'); return; }
      const bytes = fs.readFileSync(file);
      const relative = path.relative(root, file);
      const destination = path.join(directory, 'inputs', relative);
      const stored = storeSnapshot(bytes, destination, objectRoot);
      const item = { path: file, relative_path: relative, role, referenced_by: from, captured_at: now(), bytes: bytes.length, sha256: stored.sha256, snapshot: path.relative(directory, destination),
        object_sha256: stored.sha256, object_path: path.relative(directory, stored.object), storage: stored.storage };
      known.set(file.toLowerCase(), item);
      manifest.inputs.push(item);
      event('input_captured', { path: file, sha256: item.sha256, role });
      inspect(file, bytes.toString('utf8'));
    } catch (error) {
      if (error.code === 'TRACE_INTEGRITY') throw error;
      unresolved(from, value, `Capture failed: ${String(error)}`);
    }
  }
  const finalizeDependencies = () => {
    for (const { file, expression } of pending.splice(0)) {
      const definitions = symbols.get(expression) || [];
      const local = definitions.filter(item => item.file === file);
      const choices = local.length ? local : definitions;
      if (choices.length === 1) resolveDependency(choices[0].value, choices[0].file, 'simulation_data');
      else unresolved(file, expression, choices.length ? 'Ambiguous string constant; multiple definitions were captured.' : 'Nonliteral simulation file expression could not be resolved statically.');
    }
    persist();
  };
  const finish = (status, error = null, extra = {}) => {
    if (manifest.status !== 'running') return JSON.parse(fs.readFileSync(path.join(directory, 'receipt.json'), 'utf8'));
    finalizeDependencies();
    for (const item of manifest.inputs) {
      try { item.end_sha256 = hash(fs.readFileSync(item.path)); item.drifted = item.end_sha256 !== item.sha256; }
      catch (failure) { item.end_sha256 = null; item.drifted = true; item.end_error = String(failure); }
    }
    Object.assign(manifest, { status, finished_at: now(), duration_ms: Math.round(performance.now() - start), error: error ? String(error) : null,
      input_drift: manifest.inputs.some(item => item.drifted), tool_version: extra.build_result?.version ?? null,
      tool_version_source: extra.build_result?.version ? 'build-result.json' : 'Not separately detected; inspect raw process logs.' });
    manifest.snapshot_integrity = verifyInputEvidence(manifest, directory);
    if (error) fs.appendFileSync(path.join(directory, 'process.log'), `\n[${now()}] TRACE_FAILURE ${String(error)}\n`);
    event('run_end', { status, error: manifest.error, input_drift: manifest.input_drift });
    persist();
    const receipt = { directory, process_log: path.join(directory, 'process.log'), files: fs.readdirSync(directory), ...extra,
      run_id: id, run_manifest: path.join(directory, 'run.json'), status, error: manifest.error, input_drift: manifest.input_drift,
      trace_id: manifest.trace_id, span_id: manifest.span_id, context: manifest.context, snapshot_integrity: manifest.snapshot_integrity.valid,
      unresolved_dependency_count: manifest.unresolved_dependencies.length };
    save(path.join(directory, 'receipt.json'), receipt);
    return receipt;
  };
  persist();
  save(path.join(directory, 'retention.json'), { schema_version: 1, run_id: id, pinned: false, automatic_deletion: false,
    preserve: ['run.json', 'receipt.json', 'events.jsonl', 'process.log', 'inputs/**', '*.rpt', '*.json', '*.tcl', '*.xdc', '*.dcp', '*.log', '*.jou', '*.raw'],
    failed_or_incomplete_runs: 'Preserve all files, including waveforms.',
    review_candidates: 'Only old completed unpinned runs: waveform files or explicitly identified rebuildable caches; a plan never deletes files.',
    future_waveform_default: 'off; opt in for bounded signals/time windows when diagnosing a specific issue.' });
  event('run_start', { tool, tool_call_id: toolCallId });
  return { root, directory, manifest, event, persist, capture, finalizeDependencies, finish };
}

export function captureToolInputs(trace, args = {}) {
  for (const file of ['src/tools/eda.ts', 'src/trace.mjs', 'scripts/eda-tool.mjs', 'package.json', 'package-lock.json']) trace.capture(file, 'runner');
  const inputs = [...(Array.isArray(args.sources) ? args.sources : []), args.script, args.netlist, args.analogLog].filter(value => typeof value === 'string');
  for (const file of inputs) trace.capture(file);
  if (trace.manifest.tool === 'eda_verify') {
    trace.capture('scripts/verify-results.py', 'acceptance_code');
    for (const [name, files] of [['xsim', ['process.log']], ['vivado', ['build-result.json', 'timing-summary.rpt', 'check-timing.rpt']]]) {
      if (args[name]) for (const file of files) trace.capture(path.join(args[name], file), 'acceptance_evidence');
    }
  }
  const directories = new Set();
  for (const file of inputs) {
    let directory = path.dirname(path.resolve(trace.root, file));
    for (let depth = 0; depth < 3 && /^(projects|examples)[\\/]/.test(path.relative(trace.root, directory)); depth++, directory = path.dirname(directory)) directories.add(directory);
  }
  for (const directory of directories) {
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory)) {
      if (/^(?:(?:generate[^.]*|build[^.]*|prepare|run|negative_control)\.py|(?:manifest|sources|sim|impl|firmware-build)\.json)$/.test(name)) trace.capture(path.join(directory, name), 'generator_or_manifest');
    }
  }
  trace.finalizeDependencies();
}

export function runProcess(trace, exe, args, { signal, update, timeoutMs = 600000 } = {}) {
  const directory = trace.directory;
  const processId = trace.manifest.processes.length + 1;
  const record = { process_id: processId, span_id: randomUUID().replaceAll('-', '').slice(0, 16), parent_span_id: trace.manifest.span_id, exe, args, cwd: directory, pid: null, started_at: now(), ended_at: null, timeout_ms: timeoutMs, exit_code: null, signal: null, termination_reason: null };
  trace.manifest.processes.push(record);
  trace.event('process_start', record);
  trace.persist();
  const started = performance.now();
  if (signal?.aborted) {
    Object.assign(record, { ended_at: now(), duration_ms: 0, termination_reason: 'abort_before_start' });
    trace.event('process_end', record); trace.persist();
    return Promise.reject(new Error(`Cancelled before process startup; inspect ${directory}`));
  }
  const logPath = path.join(directory, 'process.log');
  const fd = fs.openSync(logPath, 'a');
  fs.writeSync(fd, `\n[${now()}] ${JSON.stringify([exe, ...args])}\n`);
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: directory, windowsHide: true, stdio: ['ignore', fd, fd], env: { ...process.env, EDA_WORKSPACE: trace.root } });
    record.pid = child.pid ?? null;
    trace.event('process_spawned', { process_id: processId, pid: record.pid });
    trace.persist();
    let settled = false;
    const stop = reason => {
      if (settled || record.termination_reason || child.exitCode !== null || !child.pid) return;
      record.termination_reason = reason;
      trace.event('process_stop_requested', { process_id: processId, pid: child.pid, reason });
      trace.persist();
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', error => { trace.event('process_stop_error', { process_id: processId, error: String(error) }); child.kill(); });
      } else child.kill('SIGKILL');
    };
    const abort = () => stop('abort');
    const timeout = setTimeout(() => stop('timeout'), timeoutMs);
    const progress = setInterval(() => update?.({ content: [{ type: 'text', text: `Running ${path.basename(exe)}; log: ${logPath}` }], details: { directory } }), 15000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const finish = (code, exitSignal, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout); clearInterval(progress);
      signal?.removeEventListener('abort', abort);
      fs.closeSync(fd);
      Object.assign(record, { ended_at: now(), duration_ms: Math.round(performance.now() - started), exit_code: code, signal: exitSignal,
        termination_reason: record.termination_reason || (error ? 'spawn_error' : code === 0 ? 'completed' : 'exit_nonzero'), error: error ? String(error) : null });
      trace.event('process_end', record); trace.persist();
      if (error || code !== 0 || record.termination_reason !== 'completed') reject(new Error(`Process ${record.termination_reason} (exit ${code}); inspect ${logPath}${error ? `; ${error}` : ''}`));
      else resolve(record);
    };
    child.once('error', error => finish(null, null, error));
    child.once('close', (code, exitSignal) => finish(code, exitSignal, null));
  });
}
