import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createJiti } from 'jiti';
import { createTrace, captureToolInputs, runProcess, verifyInputEvidence } from '../trace.mjs';
import { defaultRoot, loadCatalog, selectCases, hash } from './catalog.mjs';
import { preflight, prepareCase } from './prepare.mjs';
import { evaluateAcceptance, guardIntegrity } from './acceptance.mjs';

const save = (file, data) => { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n'); fs.renameSync(temporary, file); };
const filters = options => ['ids', 'category', 'tier', 'tool'].some(key => options[key] !== undefined) ? options : { ...options, tier: 'smoke' };
const evaluatorFiles = ['src/bench/acceptance.mjs', 'scripts/verilogeval-verdict.mjs'];
const runnerFiles = ['src/runtime.mjs', '.eda/config.json', 'src/bench/catalog.mjs', 'src/bench/generators.mjs', 'src/bench/prepare.mjs', 'src/bench/runner.mjs', 'src/bench/compare.mjs', 'src/bench/index.mjs', 'benchmarks/catalog.json', 'benchmarks/catalog.schema.json', ...evaluatorFiles];
function validOptions(options) {
  if (options.seed !== undefined && (!Number.isSafeInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff)) throw new Error('seed must be an unsigned 32 bit integer');
  if (options.concurrency !== undefined && (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 4)) throw new Error('concurrency must be 1..4');
}
export function planBenchmark(options = {}) {
  validOptions(options);
  const root = options.root || defaultRoot, catalog = loadCatalog(root);
  const cases = selectCases(catalog, filters(options)).map(item => ({ ...item, effective_seed: options.seed ?? item.seed, preflight: preflight(root, item) }));
  return { schema_version: 1, catalog_version: catalog.catalog_version, catalog_sha256: hash(catalog),
    selection: Object.fromEntries(['ids', 'category', 'tier', 'tool'].filter(key => filters(options)[key] !== undefined).map(key => [key, filters(options)[key]])),
    case_count: cases.length, family_count: new Set(cases.map(item => item.family)).size,
    runnable: cases.filter(item => item.preflight.runnable).length, blocked: cases.filter(item => !item.preflight.runnable).length,
    concurrency: { simulation: options.concurrency ?? 2, implementation: 1, note: 'Additional global runtime limits may reduce concurrency.' },
    waveform_logging: false, model_api_calls: 0, cases };
}

export async function scheduleCases(items, worker, concurrency = 2, signal) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('concurrency must be 1..4');
  const results = new Array(items.length);
  const lanes = [items.map((item, index) => ({ item, index })).filter(({ item }) => item.tier !== 'implementation'), items.map((item, index) => ({ item, index })).filter(({ item }) => item.tier === 'implementation')];
  const group = async (queue, width) => {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(width, queue.length) }, async () => {
      while (next < queue.length) {
        const { item, index } = queue[next++];
        results[index] = await worker(item, index, Boolean(signal?.aborted));
      }
    }));
  };
  await Promise.all([group(lanes[0], concurrency), group(lanes[1], 1)]);
  return results;
}

async function invokeNodeTool(root, item, args, signal, context) {
  const trace = createTrace({ root, tool: 'benchmark_node_test', args, toolCallId: context.case_id, context });
  captureToolInputs(trace, args);
  try {
    const argv = item.input.kind === 'timeout_fixture' ? [args.script] : ['--test', '--test-reporter=tap', args.script];
    await runProcess(trace, process.execPath, argv, { signal, timeoutMs: item.input.process_timeout_ms || item.timeout_ms });
    return { details: trace.finish('completed') };
  } catch (error) {
    const termination = trace.manifest.processes.at(-1)?.termination_reason;
    const receipt = trace.finish(termination === 'timeout' ? 'timed_out' : termination?.startsWith('abort') ? 'cancelled' : 'failed', error);
    throw Object.assign(new Error(String(error)), { receipt });
  }
}

function countsFor(cases) {
  return Object.fromEntries(['PASS', 'FAIL', 'EXPECTED_FAILURE', 'EXPECTED_TIMEOUT', 'TIMEOUT', 'INCOMPLETE', 'BLOCKED'].map(status => [status, cases.filter(item => item.acceptance?.status === status).length]));
}
function markdown(summary) {
  return [`# Benchmark ${summary.run_id}`, '',
    `Status: ${summary.status}. ${summary.case_count} case variants in ${summary.family_count} families. Model API calls: 0.`,
    `UTC: ${summary.started_at} to ${summary.finished_at || 'running'}. Wall time: ${summary.duration_ms ?? 'pending'} ms.`,
    '', '| Case | Family / variant | Tool exit | Acceptance | Seconds |', '|---|---|---:|---|---:|',
    ...summary.cases.map(item => `| ${item.id} | ${item.family} / ${item.variant} | ${item.tool_exit ?? 'none'} | ${item.acceptance.status} | ${((item.duration_ms || 0) / 1000).toFixed(3)} |`), '',
    'Negative controls are separate from design PASS counts. TIMEOUT, incomplete and blocked cases are never PASS. Generated variants are local regression exercises, not independent external benchmark problems.',
    'Full inputs, hashes, acceptance rules, events and raw tool receipt links are in each case result.json and summary.json. Original vendor directories and project latest pointers are not changed.', '',
  ].join('\n');
}

export async function runBenchmark(options = {}) {
  validOptions(options);
  const root = fs.realpathSync(options.root || defaultRoot), plan = planBenchmark({ ...options, root });
  if (!plan.cases.length) throw new Error('No cases selected');
  const runId = `benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const directory = path.join(root, 'artifacts', runId);
  fs.mkdirSync(directory, { recursive: true });
  const summary = { schema_version: 1, run_id: runId, directory, catalog_version: plan.catalog_version, catalog_sha256: plan.catalog_sha256,
    started_at: new Date().toISOString(), finished_at: null, status: 'running', case_count: plan.case_count,
    family_count: plan.family_count, concurrency: plan.concurrency, selection: plan.selection, model_api_calls: 0,
    outer_codex_tokens: null, outer_codex_cost: null, cases: [] };
  const start = performance.now();
  save(path.join(directory, 'plan.json'), plan);
  save(path.join(directory, 'catalog.json'), loadCatalog(root));
  save(path.join(directory, 'summary.json'), summary);
  const event = (type, details) => fs.appendFileSync(path.join(directory, 'events.jsonl'), JSON.stringify({ timestamp_utc: new Date().toISOString(), campaign_id: runId, type, ...details }) + '\n');
  event('campaign_start', { case_count: plan.case_count });
  const registry = new Map();
  let registryError = null;
  try {
    if (plan.cases.some(item => item.preflight.runnable && item.tool !== 'node_test')) (await createJiti(import.meta.url).import(path.join(root, 'src/tools/eda.ts'), { default: true }))({ registerTool: tool => registry.set(tool.name, tool) });
  } catch (error) { registryError = error; event('tool_registry_error', { error: String(error) }); }
  const worker = async (item, index, cancelled) => {
    const caseDirectory = path.join(directory, 'cases', item.id); fs.mkdirSync(caseDirectory, { recursive: true });
    const started = performance.now();
    const definition = { ...item }; delete definition.preflight; delete definition.effective_seed;
    const result = { id: item.id, family: item.family, variant: item.variant, category: item.category, tier: item.tier,
      origin: item.origin, seed: item.effective_seed, negative_control: Boolean(item.negative_control),
      case_definition_sha256: hash(definition), catalog_version: plan.catalog_version, catalog_sha256: plan.catalog_sha256,
      directory: caseDirectory, started_at: new Date().toISOString(), tool: item.tool, tool_exit: null,
      tool_status: 'not_started', input_sha256: null, acceptance_sha256: hash({ spec: item.acceptance, code: evaluatorFiles.map(file => ({ file, sha256: hash(fs.readFileSync(path.join(root, file))) })) }) };
    event('case_start', { case_id: item.id, index, seed: result.seed });
    let caseTrace, receipt, error = null, timedOut = false, timeout;
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      if (cancelled || options.signal?.aborted) result.acceptance = { status: 'INCOMPLETE', passed: false, reason: 'Campaign cancelled before case startup.' };
      else if (!item.preflight.runnable) result.acceptance = { status: 'BLOCKED', passed: false, reason: item.preflight.reason, missing: item.preflight.missing };
      else {
        if (registryError && item.tool !== 'node_test') throw registryError;
        const prepared = prepareCase(root, item, caseDirectory, result.seed);
        caseTrace = createTrace({ root, tool: 'benchmark_case', args: prepared.args, toolCallId: `${runId}:${item.id}`, artifactRoot: caseDirectory, context: { campaign_id: runId, case_id: item.id } });
        caseTrace.manifest.seed = result.seed;
        captureToolInputs(caseTrace, prepared.args);
        for (const file of [...prepared.files, ...runnerFiles.map(file => path.join(root, file))]) caseTrace.capture(file, 'benchmark_input');
        caseTrace.finalizeDependencies();
        const candidatePaths = new Set(prepared.candidateFiles);
        for (const input of caseTrace.manifest.inputs) if (input.role === 'verilog_include' && candidatePaths.has(input.referenced_by)) candidatePaths.add(input.path);
        const manifest = caseTrace.manifest.inputs.map(input => ({ path: input.path.startsWith(caseDirectory + path.sep) ? `case/${path.relative(caseDirectory, input.path).replaceAll('\\', '/')}` : input.relative_path.replaceAll('\\', '/'), sha256: input.sha256, bytes: input.bytes,
          comparison_role: candidatePaths.has(input.path) ? 'candidate' : /^(?:src[\\/]|scripts[\\/]|package|\.eda[\\/])/.test(input.relative_path) ? 'runtime' : 'task' })).sort((a, b) => a.path.localeCompare(b.path));
        // arguments.json contains unique run paths; the frozen case definition carries its logical identity.
        result.input_sha256 = hash(manifest.filter(input => input.path !== 'case/arguments.json' && !input.path.startsWith('src/bench/') && !input.path.startsWith('benchmarks/') && !evaluatorFiles.includes(input.path)));
        const fingerprint = entries => hash(entries.map(({ path, sha256 }) => ({ path, sha256 })));
        result.task_sha256 = fingerprint(manifest.filter(input => input.comparison_role === 'task' && input.path !== 'case/arguments.json'));
        result.candidate_sha256 = fingerprint(manifest.filter(input => input.comparison_role === 'candidate'));
        result.generator_sha256 = item.input.kind === 'generated' ? hash(fs.readFileSync(path.join(root, 'src/bench/generators.mjs'))) : 'not_generated';
        result.runtime_sha256 = fingerprint(manifest.filter(input => input.comparison_role === 'runtime'));
        result.input_manifest = manifest; result.adaptation = prepared.adaptation;
        save(path.join(caseDirectory, 'before-run.json'), { ...result, acceptance_rule: item.acceptance, prepared_arguments: prepared.args, trace: caseTrace.directory });
        timeout = setTimeout(() => { timedOut = true; controller.abort(); }, item.timeout_ms);
        const context = { campaign_id: runId, case_id: item.id, parent_run_id: caseTrace.manifest.run_id, trace_id: caseTrace.manifest.trace_id, parent_span_id: caseTrace.manifest.span_id };
        try {
          const value = item.tool === 'node_test' ? await invokeNodeTool(root, item, prepared.args, controller.signal, context)
            : await registry.get(item.tool).execute(`${runId}:${item.id}`, prepared.args, controller.signal,
              update => event('tool_progress', { case_id: item.id, text: update.content?.[0]?.text || '', directory: update.details?.directory || null }), { edaTraceContext: context });
          receipt = value.details; result.tool_call_succeeded = true;
        } catch (failure) { error = String(failure); receipt = failure.receipt; }
        clearTimeout(timeout);
        result.tool_status = receipt?.status || 'failed';
        let nativeRun = null;
        if (receipt?.run_manifest && fs.existsSync(receipt.run_manifest)) nativeRun = JSON.parse(fs.readFileSync(receipt.run_manifest, 'utf8'));
        result.tool_exit = nativeRun?.processes?.at(-1)?.exit_code ?? null;
        result.tool_call_succeeded ??= false;
        result.processes = nativeRun?.processes || [];
        result.tool_receipt = receipt || null;
        const transcript = receipt?.process_log && fs.existsSync(receipt.process_log) ? fs.readFileSync(receipt.process_log, 'utf8') : '';
        const oracleFile = receipt?.directory && path.join(receipt.directory, 'oracle-result.json');
        result.acceptance = evaluateAcceptance(item.acceptance, { receipt, transcript, error, tool_exit: result.tool_exit, timedOut,
          oracleResult: oracleFile && fs.existsSync(oracleFile) ? JSON.parse(fs.readFileSync(oracleFile, 'utf8')) : null });
        result.acceptance = guardIntegrity(result.acceptance, { input_drift: nativeRun?.input_drift, snapshot_integrity: receipt?.snapshot_integrity });
        result.tool_environment = { tool: item.tool, executables: [...new Set((nativeRun?.processes || []).map(process => process.exe))],
          version: nativeRun?.tool_version || transcript.match(/(?:Vivado Simulator|Vivado v|LTspice(?:\s+XVII)?)\s*v?([\d.]+)/i)?.[1] || null,
          runtime: nativeRun?.runtime || null };
        result.tool_environment_sha256 = hash(result.tool_environment);
        result.unresolved_dependencies = [...(nativeRun?.unresolved_dependencies || []), ...caseTrace.manifest.unresolved_dependencies];
      }
    } catch (failure) { error = String(failure); result.acceptance = { status: 'FAIL', passed: false, reason: error }; }
    finally {
      clearTimeout(timeout); options.signal?.removeEventListener('abort', abort);
      if (caseTrace) {
        const drift = caseTrace.manifest.inputs.some(input => { try { return hash(fs.readFileSync(input.path)) !== input.sha256; } catch { return true; } });
        result.acceptance = guardIntegrity(result.acceptance, { input_drift: drift, snapshot_integrity: verifyInputEvidence(caseTrace.manifest, caseTrace.directory).valid });
        caseTrace.manifest.acceptance = result.acceptance;
        const caseReceipt = caseTrace.finish('completed', error, { tool_receipt: receipt || null });
        result.trace_directory = caseTrace.directory;
        result.acceptance = guardIntegrity(result.acceptance, caseReceipt);
        if (JSON.stringify(result.acceptance) !== JSON.stringify(caseTrace.manifest.acceptance)) {
          caseTrace.manifest.acceptance = result.acceptance;
          caseTrace.event('acceptance_corrected_after_finalization', { acceptance: result.acceptance }); caseTrace.persist();
        }
      }
    }
    result.finished_at = new Date().toISOString(); result.duration_ms = Math.round(performance.now() - started); result.error = error;
    save(path.join(caseDirectory, 'result.json'), result);
    summary.cases.push(result); summary.counts = countsFor(summary.cases);
    save(path.join(directory, 'summary.json'), summary);
    event('case_end', { case_id: item.id, tool_exit: result.tool_exit, acceptance: result.acceptance.status, duration_ms: result.duration_ms });
    return result;
  };
  summary.cases = await scheduleCases(plan.cases, worker, options.concurrency ?? 2, options.signal);
  summary.finished_at = new Date().toISOString(); summary.duration_ms = Math.round(performance.now() - start); summary.counts = countsFor(summary.cases);
  summary.status = summary.cases.every(item => ['PASS', 'EXPECTED_FAILURE', 'EXPECTED_TIMEOUT'].includes(item.acceptance.status)) ? 'completed' : 'completed_with_failures';
  event('campaign_end', { status: summary.status, counts: summary.counts, duration_ms: summary.duration_ms });
  save(path.join(directory, 'summary.json'), summary); fs.writeFileSync(path.join(directory, 'REPORT.md'), markdown(summary));
  return summary;
}

export function reportBenchmark(runDirectory) {
  const directory = path.resolve(runDirectory);
  const summary = JSON.parse(fs.readFileSync(path.join(directory, 'summary.json'), 'utf8'));
  if (summary.schema_version !== 1 || !Array.isArray(summary.cases)) throw new Error('Unsupported benchmark summary');
  return { ...summary, markdown: markdown(summary) };
}
