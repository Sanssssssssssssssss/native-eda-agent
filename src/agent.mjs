import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { createJiti } from 'jiti';
import { spawnSync } from 'node:child_process';
import { readConfig, listRuns, reconcileRuns } from './runtime.mjs';
import { doctor } from './platform.mjs';
import { edaResourceOptions } from './agent-resources.mjs';
import { createAgentSession, createCodemodeExtension, createMcpExtension,
  createToolSearchExtension, DefaultResourceLoader, SettingsManager,
} from '@earendil-works/pi-coding-agent';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agentDir = path.join(root, '.pi-state');
process.chdir(root);
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PYTHONIOENCODING = 'utf-8';
const jiti = createJiti(import.meta.url);
const edaExtension = await jiti.import(path.join(root, 'src/extension.ts'), { default: true });
const nativeTools = new Map();
edaExtension({ registerTool: tool => nativeTools.set(tool.name, tool) });

function outputDir(label) {
  const dir = path.join(root, 'artifacts', `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function save(file, object) { fs.writeFileSync(file, JSON.stringify(object, null, 2) + '\n'); }

async function verify() {
  const dir = outputDir('native-check');
  const results = { date: new Date().toISOString(), mode: 'deterministic-tool-check', directory: dir };
  const call = async (name, args) => {
    console.log(`[tool] ${name}`);
    const value = await nativeTools.get(name).execute(randomUUID(), args, undefined,
      update => console.log(`[progress] ${update.content[0].text}`));
    return value.details;
  };
  try {
    results.xsim = await call('eda_xsim', { sources: ['examples/digital/counter.v', 'examples/digital/tb_counter.sv'], top: 'tb_counter' });
    results.vivado = await call('eda_vivado', { script: 'examples/digital/build-core.tcl' });
    results.ac = await call('eda_ltspice_batch', { netlist: 'examples/analog/rc_ac.cir' });
    results.transient = await call('eda_ltspice_batch', { netlist: 'examples/analog/rc_tran.cir' });
    const combined = path.join(dir, 'analog-combined.log');
    fs.writeFileSync(combined, `# AC source: ${results.ac.simulation_log}\n${results.ac.measurements_and_log}\n# Transient source: ${results.transient.simulation_log}\n${results.transient.measurements_and_log}`);
    results.verification = await call('eda_verify', { xsim: results.xsim.directory, vivado: results.vivado.directory, analogLog: combined });
    results.passed = true;
  } catch (error) {
    results.passed = false;
    results.error = String(error);
    process.exitCode = 1;
  }
  save(path.join(dir, 'result.json'), results);
  console.log(JSON.stringify(results.verification?.acceptance || results, null, 2));
  console.log(`Evidence: ${dir}`);
}

async function agentRun(prompt, limits) {
  const dir = outputDir('native-agent');
  const started = performance.now();
  const run = { schemaVersion: 1, runId: path.basename(dir), mode: 'pi-sdk-agent', workspace: root,
    startedAt: new Date().toISOString(), status: 'initializing', limits,
    nodeVersion: process.version, inputSnapshotScope: 'Listed orchestration files only; tool runs record their own dependencies.',
    inputs: [] };
  run.trace_id = createHash('sha256').update(run.runId).digest('hex').slice(0, 32);
  run.span_id = createHash('sha256').update(`span:${run.runId}`).digest('hex').slice(0, 16);
  fs.mkdirSync(path.join(dir, 'inputs'));
  fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt);
  const skillDirectories = ['.pi/skills', '.agents/skills'];
  const skillInputs = skillDirectories.flatMap(relative => {
    const directory = path.join(root, relative);
    return fs.existsSync(directory) ? fs.readdirSync(directory, { recursive: true })
      .filter(file => fs.statSync(path.join(directory, file)).isFile()).map(file => path.join(relative, file)) : [];
  });
  for (const relative of ['src/agent.mjs', 'src/task-context.mjs', 'src/task-outcome.mjs', 'src/workflow.mjs', 'src/agent-resources.mjs', 'src/knowledge.mjs', 'scripts/check-knowledge.mjs', 'knowledge/sops.json', 'knowledge/tools.json', 'src/extension.ts', 'src/platform.mjs', 'src/runtime.mjs', 'src/tools/eda.ts', 'src/tools/fpga.mjs', 'src/tools/optimizer.mjs', 'src/optimizer-inspection.mjs', 'src/fpga_optimizer/trace.py', 'src/fpga_optimizer/runner.py', 'src/fpga_optimizer/core.py', 'src/fpga_optimizer/backend.py', 'src/tools/vivado-common.tcl', 'src/tools/xsim-options.mjs', 'src/trace.mjs', 'package.json', 'package-lock.json', '.eda/config.json', '.pi/APPEND_SYSTEM.md', '.pi/settings.json', 'knowledge/rules.json', 'knowledge/sources.json', 'benchmarks/catalog.json', ...skillInputs]) {
    const source = path.join(root, relative);
    if (!fs.existsSync(source)) continue;
    const bytes = fs.readFileSync(source);
    const target = path.join('inputs', relative);
    fs.mkdirSync(path.dirname(path.join(dir, target)), { recursive: true });
    fs.writeFileSync(path.join(dir, target), bytes);
    run.inputs.push({ path: relative, snapshot: target, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  save(path.join(dir, 'run.json'), run);
  const events = fs.openSync(path.join(dir, 'events.jsonl'), 'a');
  let sequence = 0;
  const recordEvent = event => fs.writeSync(events, JSON.stringify({ ...event, schema_version: 1,
    timestamp_utc: new Date().toISOString(), seq: ++sequence, sequence, run_id: run.runId, agent_run_id: run.runId,
    session_id: run.sessionId, trace_id: run.trace_id, span_id: run.span_id, parent_span_id: null }) + '\n');
  recordEvent({ type: 'run_start', phase: 'initializing', limits });
  let session;
  try {
  const settingsManager = SettingsManager.create(root, agentDir);
  const loader = new DefaultResourceLoader(edaResourceOptions({
    root, agentDir, settingsManager,
    extensionFactories: [pi => edaExtension(pi, { traceContext: () => ({ parent_run_id: run.runId,
      session_id: run.sessionId, trace_id: run.trace_id, parent_span_id: run.span_id }) }),
      createCodemodeExtension({ mode: 'on' }), createToolSearchExtension(), createMcpExtension()],
  }));
  await loader.reload();
  run.resources={skills:loader.getSkills().skills.map(skill=>({name:skill.name,path:path.relative(root,skill.filePath).replaceAll('\\','/')}))};
  recordEvent({type:'resources_loaded',...run.resources});
  const created = await createAgentSession({ cwd: root, agentDir, settingsManager, resourceLoader: loader });
  session = created.session;
  const { extensionsResult } = created;
  if (extensionsResult.errors.length) throw new Error(JSON.stringify(extensionsResult.errors));
  } catch (error) {
    run.status = 'initialization_failed';
    run.error = String(error);
    run.endedAt = new Date().toISOString();
    run.wallSeconds = (performance.now() - started) / 1000;
    save(path.join(dir, 'run.json'), run);
    save(path.join(dir, 'usage.json'), { scope: 'pi-sdk-agent', status: run.status, stats: null,
      reason: 'Initialization failed before a usable session; no token estimate invented.' });
    recordEvent({ type: 'run_end', status: run.status, error_type: error?.name || 'Error' });
    fs.closeSync(events);
    session?.dispose();
    console.error(`${run.error}; evidence: ${dir}`);
    process.exitCode = 1;
    return;
  }
  run.status = 'running';
  run.provider = session.model?.provider;
  run.model = session.model?.id;
  run.sessionId = session.getSessionStats().sessionId;
  save(path.join(dir, 'run.json'), run);
  recordEvent({ type: 'session_ready', limits });
  let turns = 0;
  let stoppedReason = null;
  let failure = null;
  const abort = reason => { stoppedReason ||= reason; void session.abort(); };
  const onInterrupt = () => abort('user-interrupt');
  process.on('SIGINT', onInterrupt);
  const deadline = setTimeout(() => abort('wall-time-limit'), limits.timeoutSeconds * 1000);
  const unsubscribe = session.subscribe(event => {
    // Finalized messages retain tool calls/results and usage without streaming duplication.
    if (['message_end', 'tool_execution_start', 'tool_execution_end', 'agent_end', 'auto_retry_start', 'auto_retry_end'].includes(event.type)) {
      recordEvent(event);
    }
    if (event.type === 'turn_start' && ++turns > limits.maxTurns) abort('model-turn-limit');
    if (event.type === 'tool_execution_start') console.log(`[tool] ${event.toolName}`);
    if (event.type === 'tool_execution_update' && event.partialResult?.content?.[0]?.text) {
      console.log(`[progress] ${event.partialResult.content[0].text.slice(0, 200)}`);
    }
    if (event.type === 'message_end' && event.message.role === 'assistant' && event.message.stopReason === 'error') {
      failure = event.message.errorMessage || 'Model request failed';
    }
    if (event.type === 'message_end' && event.message.role === 'assistant' && event.message.stopReason === 'aborted') {
      stoppedReason ||= 'model-aborted';
    }
    if (event.type === 'auto_retry_end' && event.success === true) failure = null;
    if (event.type === 'auto_retry_end' && event.success === false) failure = event.finalError || failure || 'Model retries exhausted';
  });
  try {
    await session.bindExtensions({});
    console.log(`EDA Agent / Pi SDK 1.3.0 / ${session.model?.provider}/${session.model?.id}`);
    console.log(`Limits: ${limits.maxTurns} model turns, ${limits.timeoutSeconds}s. Evidence: ${dir}`);
    await session.prompt(prompt);
    const answer = session.getLastAssistantText() || '';
    fs.writeFileSync(path.join(dir, 'answer.md'), answer + '\n');
    console.log(answer);
  } catch (error) {
    failure = String(error);
    console.error(failure);
  } finally {
    clearTimeout(deadline);
    unsubscribe();
    process.removeListener('SIGINT', onInterrupt);
    run.status = stoppedReason ? 'stopped' : failure ? 'failed' : 'completed';
    run.endedAt = new Date().toISOString();
    run.wallSeconds = (performance.now() - started) / 1000;
    run.stoppedReason = stoppedReason;
    run.error = failure;
    run.inputDrift = run.inputs.filter(input => {
      const source = path.join(root, input.path);
      return !fs.existsSync(source) || createHash('sha256').update(fs.readFileSync(source)).digest('hex') !== input.sha256;
    }).map(input => input.path);
    const usage = { scope: 'pi-sdk-agent-only', agentRunId: run.runId,
      outerCodexUsage: 'Recorded separately from local Codex sessions; not included in Pi statistics.',
      costBasis: 'Pi provider catalog estimate, not an invoice', piVersion: '1.3.0', provider: session.model?.provider,
      model: session.model?.id, thinking: session.thinkingLevel, limits, turns, stoppedReason,
      error: failure, stats: session.getSessionStats() };
    try {
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    } catch (error) {
      recordEvent({ type: 'shutdown_error', error: String(error) });
      run.status = 'shutdown_failed';
      run.shutdownError = String(error);
      process.exitCode = 1;
    } finally {
      try { session.dispose(); }
      catch (error) {
        run.status = 'dispose_failed'; run.disposeError = String(error);
        recordEvent({ type: 'dispose_error', error: String(error) });
        process.exitCode = 1;
      }
      run.endedAt = new Date().toISOString();
      run.wallSeconds = (performance.now() - started) / 1000;
      run.error = failure || run.shutdownError || run.disposeError || null;
      usage.status = run.status; usage.error = run.error;
      save(path.join(dir, 'run.json'), run);
      save(path.join(dir, 'usage.json'), usage);
      recordEvent({ type: 'run_end', status: run.status, stoppedReason, error: run.error, wallSeconds: run.wallSeconds });
      fs.closeSync(events);
    }
    if (stoppedReason || failure) {
      console.error(`[stopped] ${stoppedReason || failure}; see ${path.join(dir, 'usage.json')}`);
      process.exitCode = 1;
    }
  }
}

const [command = 'help', ...args] = process.argv.slice(2);
if (command === 'doctor') {
  const report = { ...doctor(root), nativeTools: [...nativeTools.keys()] };
  console.log(JSON.stringify(report, null, 2));
  if (!report.vivado.exists || !report.ltspice.exists) process.exitCode = 1;
} else if (['benchmark', 'trace', 'storage', 'recover', 'export-trace', 'workflow'].includes(command)) {
  // These offline CLI modules own their argument parsers and never start a model session.
  const script = { benchmark: 'benchmark.mjs', trace: 'trace-inspect.mjs', storage: 'artifact-inventory.mjs', recover: 'recover-optimizer.mjs', 'export-trace': 'export-traces.mjs', workflow: 'workflow.mjs' }[command];
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else if (command === 'knowledge') {
  const result=await nativeTools.get('eda_knowledge').execute(randomUUID(),args.length?{query:args.join(' ')}:{});
  console.log(JSON.stringify(result.details,null,2));
} else if (command === 'sop') {
  const result=await nativeTools.get('eda_sop').execute(randomUUID(),args.length?{id:args[0]}:{});
  console.log(JSON.stringify(result.details,null,2));
} else if (command === 'runs') {
  console.log(JSON.stringify(args[0] === '--reconcile' ? reconcileRuns(root) : listRuns(root), null, 2));
} else if (command === 'verify') {
  await verify();
} else if (command === 'run' || command === 'demo') {
  if (!readConfig(root).model_api_enabled) throw new Error('Model API is disabled in .eda/config.json; offline benchmark, verify and MCP remain available.');
  const limits = { maxTurns: 24, timeoutSeconds: 600 };
  let file;
  while (args[0]?.startsWith('--')) {
    const option = args.shift();
    const value = args.shift();
    if (option === '--max-turns') limits.maxTurns = Number(value);
    else if (option === '--timeout') limits.timeoutSeconds = Number(value);
    else if (option === '--prompt-file') file = value;
    else throw new Error(`Unknown option ${option}`);
  }
  if (!Number.isSafeInteger(limits.maxTurns) || limits.maxTurns < 1 || !Number.isSafeInteger(limits.timeoutSeconds) || limits.timeoutSeconds < 1) throw new Error('Limits must be positive integers');
  const prompt = command === 'demo' ? fs.readFileSync(path.join(root, 'prompts/native-demo.md'), 'utf8')
    : file ? fs.readFileSync(path.resolve(root, file), 'utf8') : args.join(' ');
  if (!prompt.trim()) throw new Error('Supply a task or --prompt-file.');
  await agentRun(prompt, limits);
} else {
  console.log('EDA Agent — Pi SDK + local tools + MCP\n\n  .\\eda.ps1 doctor\n  .\\eda.ps1 benchmark list|plan|run|report|compare\n  .\\eda.ps1 knowledge timing\n  .\\eda.ps1 trace RUN_DIRECTORY\n  .\\eda.ps1 recover RUN_DIRECTORY --check-only\n  .\\eda.ps1 export-trace RUN_DIRECTORY --output FILE.json\n  .\\eda.ps1 storage --plan\n  .\\eda.ps1 runs [--reconcile]\n  npm run knowledge -- QUERY\n  npm run sop -- [SOP_ID]\n  npm run workflow -- plan|run SPEC.json\n  npm run validate:agent\n  .\\eda.ps1 verify\n  .\\eda.ps1 chat\n  .\\eda.ps1 run "任务描述"   # requires model_api_enabled=true\n\nrun/demo: --max-turns 24 --timeout 600; run also accepts --prompt-file PATH');
}
