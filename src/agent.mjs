import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createJiti } from 'jiti';
import { spawnSync } from 'node:child_process';
import { readConfig, listRuns, reconcileRuns } from './runtime.mjs';
import { doctor } from './platform.mjs';
import { runAgentSession } from './agent-session.mjs';

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

async function agentRun(prompt, limits, options = {}) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  try {
    const result = await runAgentSession({ root, prompt, limits, ...options, signal: controller.signal,
      onEvent: event => {
        if (event.type === 'tool_execution_start') console.log(`[tool] ${event.toolName}`);
      },
    });
    console.log(result.answer);
    console.log(`Evidence: ${result.directory}`);
    if (result.status !== 'completed') {
      console.error(result.run.error || result.run.stoppedReason || result.status);
      process.exitCode = 1;
    }
    if (options.verification) {
      console.log(`Engineering acceptance: ${result.run.task_acceptance?.status || 'unknown'}`);
      if (result.run.task_acceptance?.status !== 'passed') process.exitCode = 1;
    }
  } finally {
    process.removeListener('SIGINT', interrupt);
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
} else if (command === 'verification') {
  if(args[0] !== 'plan' || !args[1]) throw new Error('Usage: verification plan FILE.json');
  const {prepareVerification} = await import('./verifier-loop.mjs');
  const configuration = JSON.parse(fs.readFileSync(path.resolve(root,args[1]),'utf8'));
  const contract = prepareVerification(root,configuration,nativeTools);
  const directory = outputDir('verification-plan');
  save(path.join(directory,'verification-contract.json'),contract);
  console.log(JSON.stringify({valid:true,spec:contract.plan.spec_path,editable_sources:contract.editable_sources,
    protected_input_count:Object.keys(contract.protected_inputs).length,acceptance_profile:contract.plan.acceptance.profile,
    max_rounds:configuration.max_rounds,max_calls:configuration.max_calls,launches_eda:false,model_api_calls:0,directory},null,2));
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
  let file, verificationFile, taskDirectory;
  while (args[0]?.startsWith('--')) {
    const option = args.shift();
    const value = args.shift();
    if (option === '--max-turns') limits.maxTurns = Number(value);
    else if (option === '--timeout') limits.timeoutSeconds = Number(value);
    else if (option === '--prompt-file') file = value;
    else if (option === '--verification') verificationFile = value;
    else if (option === '--task-directory') taskDirectory = value;
    else throw new Error(`Unknown option ${option}`);
  }
  if (!Number.isSafeInteger(limits.maxTurns) || limits.maxTurns < 1 || !Number.isSafeInteger(limits.timeoutSeconds) || limits.timeoutSeconds < 1) throw new Error('Limits must be positive integers');
  const prompt = command === 'demo' ? fs.readFileSync(path.join(root, 'prompts/native-demo.md'), 'utf8')
    : file ? fs.readFileSync(path.resolve(root, file), 'utf8') : args.join(' ');
  if (!prompt.trim()) throw new Error('Supply a task or --prompt-file.');
  await agentRun(prompt, limits, {
    ...(verificationFile ? {verification:JSON.parse(fs.readFileSync(path.resolve(root,verificationFile),'utf8'))} : {}),
    ...(taskDirectory ? {taskDirectory} : {}),
  });
} else {
  console.log('EDA Agent — Pi SDK + local tools + MCP\n\n  .\\eda.ps1 doctor\n  .\\eda.ps1 benchmark list|plan|run|report|compare\n  .\\eda.ps1 knowledge timing\n  .\\eda.ps1 trace RUN_DIRECTORY\n  .\\eda.ps1 recover RUN_DIRECTORY --check-only\n  .\\eda.ps1 export-trace RUN_DIRECTORY --output FILE.json\n  .\\eda.ps1 storage --plan\n  .\\eda.ps1 runs [--reconcile]\n  npm run knowledge -- QUERY\n  npm run sop -- [SOP_ID]\n  npm run workflow -- plan|run SPEC.json\n  npm run validate:agent\n  .\\eda.ps1 verify\n  .\\eda.ps1 chat\n  .\\eda.ps1 run "任务描述"   # requires model_api_enabled=true\n\nrun/demo: --max-turns 24 --timeout 600 --verification FILE.json --task-directory WORKFLOW_DIR; run also accepts --prompt-file PATH');
}
