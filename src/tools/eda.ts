import { Type } from '@earendil-works/pi-ai';
import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTrace, captureToolInputs, runProcess } from '../trace.mjs';
import { readConfig, createRunState, acquireResource, runHook } from '../runtime.mjs';
import { validateXsimOptions, xsimCommands, simulationAcceptance } from './xsim-options.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const vivadoBin = process.env.EDA_VIVADO_BIN || 'E:\\Xilinx\\Vivado\\2020.2\\bin';
const ltspice = path.join(root, 'runtime/ltspice/LTspice.exe');

function inputFile(value: string) {
  const resolved = fs.realpathSync(path.resolve(root, value));
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(resolved).isFile()) {
    throw new Error('Input must be a file inside this EDA workspace.');
  }
  return resolved;
}

function validateInputs(name: string, args: any) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object');
  if (name === 'eda_xsim') {
    if (typeof args.top !== 'string' || !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(args.top)) throw new Error('Invalid testbench top name.');
    if (!Array.isArray(args.sources) || !args.sources.length) throw new Error('Expected nonempty sources');
    args.sources.forEach(inputFile);
    validateXsimOptions(root, args);
  } else if (name === 'eda_vivado') inputFile(args.script);
  else if (name === 'eda_ltspice_batch') {
    const source = inputFile(args.netlist);
    if (!['.cir', '.net'].includes(path.extname(source).toLowerCase())) throw new Error('Expected a .cir or .net file.');
    const analyses = fs.readFileSync(source, 'utf8').match(/^\s*\.(?:ac|tran|dc|noise|tf|op)\b/gim) || [];
    if (analyses.length !== 1) throw new Error('Choose exactly one analysis per netlist; use separate AC and transient files.');
  } else if (name === 'eda_verify' && ![args.xsim, args.vivado, args.analogLog].some(Boolean)) throw new Error('Provide at least one result to verify');
}

export function tracedExecute(name: string, operation: (trace: any, args: any, signal?: AbortSignal, onUpdate?: any) => Promise<Record<string, unknown>>, options: any = {}) {
  return async (id: string, args: any, signal?: AbortSignal, onUpdate?: any, ctx?: any) => {
    const trace = createTrace({ root, tool: name, args, toolCallId: id, context: ctx?.edaTraceContext });
    let state: any;
    let lease: any;
    try {
      state = createRunState(root, trace);
      state.transition('preflight');
      await runHook(trace, 'preflight', () => {
        signal?.throwIfAborted(); (options.validate || ((value: any) => validateInputs(name, value)))(args); readConfig(root);
        const executable = options.executable || (name === 'eda_xsim' ? path.join(vivadoBin, 'xvlog.bat') : name === 'eda_vivado' ? path.join(vivadoBin, 'vivado.bat') : name === 'eda_ltspice_batch' ? ltspice : null);
        if (executable && !fs.existsSync(executable)) throw new Error(`Required executable unavailable: ${executable}`);
      });
      state.transition('snapshotting');
      await runHook(trace, 'snapshot', () => {
        captureToolInputs(trace, args);
        options.capture?.(trace, args);
        if (name === 'eda_xsim') {
          trace.capture('src/tools/xsim-options.mjs', 'runner');
          trace.finalizeDependencies();
        }
        trace.capture(path.join(root, 'src/runtime.mjs'), 'runtime');
        trace.capture(path.join(root, '.eda/config.json'), 'runtime_config');
      });
      state.transition('waiting');
      const resource = options.resource || ({ eda_xsim: 'xsim', eda_vivado: 'vivado', eda_ltspice_batch: 'ltspice', eda_verify: 'verify' } as Record<string, string>)[name];
      lease = await runHook(trace, 'resource_acquire', () => acquireResource({ root, resource, runId: trace.manifest.run_id, directory: trace.directory, signal }));
      state.transition('running', { resource, slot: lease.slot, queue_wait_ms: lease.wait_ms });
      const extra = await runHook(trace, 'execute', () => operation(trace, args, signal, onUpdate));
      state.transition('finalizing');
      await runHook(trace, 'finalize', () => { lease.release(); lease = null; });
      trace.event('state_transition', { previous: 'finalizing', status: 'completed' });
      const data = trace.finish('completed', null, extra);
      state.transition('completed', {}, false);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], details: data };
    } catch (error) {
      const reason = trace.manifest.processes.at(-1)?.termination_reason;
      const status = reason === 'timeout' || (error as any)?.code === 'QUEUE_TIMEOUT' ? 'timed_out' : signal?.aborted || reason?.startsWith('abort') ? 'cancelled' : 'failed';
      if (lease) { try { lease.release(); } catch (releaseError) { trace.event('resource_release_error', { error: String(releaseError) }); } }
      if (state && state.state.status !== 'completed') state.transition(status);
      const receipt = trace.finish(status, error);
      const failure = new Error(`${String(error)}; evidence: ${trace.directory}`);
      Object.assign(failure, { receipt });
      throw failure;
    }
  };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: 'eda_xsim', label: 'XSim RTL simulation',
    description: 'Compile Verilog/SystemVerilog and VHDL, elaborate a testbench and run bounded XSim. Supports include directories, defines, top parameters, libraries, plusargs and SV seed. Optional literal pass_marker yields an explicit verdict; fatal/error/timeout overrides it. Without a marker functional acceptance remains unevaluated.',
    parameters: Type.Object({ sources: Type.Array(Type.String(), { minItems: 1 }), top: Type.String(), capture_top_wave: Type.Optional(Type.Boolean()), include_dirs: Type.Optional(Type.Array(Type.String())), defines: Type.Optional(Type.Array(Type.String())), generics: Type.Optional(Type.Array(Type.String())), libraries: Type.Optional(Type.Array(Type.String())), plusargs: Type.Optional(Type.Array(Type.String())), sv_seed: Type.Optional(Type.Integer({minimum:0,maximum:2147483647})), timeout_seconds: Type.Optional(Type.Integer({minimum:1,maximum:1800})), pass_marker: Type.Optional(Type.String({minLength:1})), vhdl_2008: Type.Optional(Type.Boolean()) }),
    execute: tracedExecute('eda_xsim', async (trace, args, signal, onUpdate) => {
      if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(args.top)) throw new Error('Invalid testbench top name.');
      const sources = args.sources.map(inputFile);
      const dir = trace.directory;
      fs.writeFileSync(path.join(dir, 'inputs.json'), JSON.stringify({ sources, top: args.top }, null, 2));
      const commands = xsimCommands(root, { ...args, sources });
      for (const command of commands.compile) await runProcess(trace, path.join(vivadoBin, command.exe), command.args, { signal, update: onUpdate });
      await runProcess(trace, path.join(vivadoBin, 'xelab.bat'), commands.elaborate, { signal, update: onUpdate, timeoutMs: 180000 });
      if (args.capture_top_wave) {
        fs.writeFileSync(path.join(dir, 'waves.tcl'), `log_wave /${args.top}/*\nrun all\nexit\n`);
      }
      await runProcess(trace, path.join(vivadoBin, 'xsim.bat'), commands.simulate, { signal, update: onUpdate, timeoutMs: (args.timeout_seconds || 600) * 1000 });
      const transcript = fs.readFileSync(path.join(dir, 'process.log'), 'utf8');
      const acceptance = simulationAcceptance(transcript, args.pass_marker);
      fs.writeFileSync(path.join(dir, 'simulation-acceptance.json'), JSON.stringify(acceptance, null, 2));
      return { transcript_tail: transcript.slice(-10000), simulation_acceptance: acceptance };
    }),
  }));
  pi.registerTool(defineTool({
    name: 'eda_vivado', label: 'Vivado Tcl build',
    description: 'Execute an authored Vivado Tcl script in a new output directory. Set EDA_WORKSPACE to the project root for resolving inputs. Supports synthesis and implementation; returns artifacts and logs, not an assumed pass verdict.',
    parameters: Type.Object({ script: Type.String() }),
    execute: tracedExecute('eda_vivado', async (trace, args, signal, onUpdate) => {
      const script = inputFile(args.script);
      const dir = trace.directory;
      fs.copyFileSync(script, path.join(dir, 'invoked.tcl'));
      await runProcess(trace, path.join(vivadoBin, 'vivado.bat'), ['-mode', 'batch', '-notrace', '-source', script, '-log', 'vivado.log', '-journal', 'vivado.jou'], { signal, update: onUpdate });
      const evidence = path.join(dir, 'build-result.json');
      return fs.existsSync(evidence) ? { build_result: JSON.parse(fs.readFileSync(evidence, 'utf8')) } : {};
    }),
  }));
  pi.registerTool(defineTool({
    name: 'eda_ltspice_batch', label: 'LTspice batch simulation',
    description: 'Run a self-contained .cir/.net netlist with the real LTspice batch engine and return its .log measurements. Copies the input into a fresh artifact directory. For external models use absolute .include paths or the official LTspice MCP in the original project directory.',
    parameters: Type.Object({ netlist: Type.String() }),
    execute: tracedExecute('eda_ltspice_batch', async (trace, args, signal, onUpdate) => {
      const source = inputFile(args.netlist);
      if (!['.cir', '.net'].includes(path.extname(source).toLowerCase())) throw new Error('Expected a .cir or .net file.');
      const dir = trace.directory;
      const target = path.join(dir, path.basename(source));
      fs.copyFileSync(source, target);
      // Reuse LTspice's initialized preferences. A fresh -ini reopens the
      // first-launch consent dialog, which blocks batch execution.
      const analyses = fs.readFileSync(target, 'utf8').match(/^\s*\.(?:ac|tran|dc|noise|tf|op)\b/gim) || [];
      if (analyses.length !== 1) throw new Error('Choose exactly one analysis per netlist; use separate AC and transient files.');
      await runProcess(trace, ltspice, ['-b', target], { signal, update: onUpdate, timeoutMs: 120000 });
      const log = target.replace(/\.(cir|net)$/i, '.log');
      if (!fs.existsSync(log)) throw new Error(`No simulation log was produced: ${dir}`);
      const raw = fs.readFileSync(log);
      const text = raw.subarray(0, 2).equals(Buffer.from([255, 254])) ? raw.toString('utf16le') : raw.toString('utf8');
      return { simulation_log: log, measurements_and_log: text.slice(-12000) };
    }),
  }));
  pi.registerTool(defineTool({
    name: 'eda_verify', label: 'Verify EDA example results',
    description: 'Check the provided counter and RC examples against fixed behavioral and mathematical acceptance criteria. Accepts artifact directory paths and one combined analog log. The result is computed independently of the model.',
    parameters: Type.Object({ xsim: Type.Optional(Type.String()), vivado: Type.Optional(Type.String()), analogLog: Type.Optional(Type.String()) }),
    execute: tracedExecute('eda_verify', async (trace, args, signal, onUpdate) => {
      const dir = trace.directory;
      const argv = [path.join(root, 'scripts/verify-results.py')];
      for (const [key, flag] of [['xsim', '--xsim'], ['vivado', '--vivado'], ['analogLog', '--analog-log']] as const) {
        if (args[key]) argv.push(flag, path.resolve(root, args[key]!));
      }
      const output = path.join(dir, 'acceptance.json');
      argv.push('--output', output);
      await runProcess(trace, 'python', argv, { signal, update: onUpdate, timeoutMs: 30000 });
      return { acceptance: JSON.parse(fs.readFileSync(output, 'utf8')) };
    }),
  }));
}
