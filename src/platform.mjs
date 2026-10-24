import fs from 'node:fs';
import path from 'node:path';
import { createTrace } from './trace.mjs';
import { listRuns, reconcileRuns, readConfig } from './runtime.mjs';
import { inspectTrace } from '../scripts/trace-inspect.mjs';
import { prepareRecovery } from './optimizer-recovery.mjs';
import { exportTraces } from './trace-export.mjs';
import { platformSurfaces } from './tools/focused.mjs';
import { specializeSchema } from './tool-contracts.mjs';
import { historyDefinitions, getResult, resultPath } from './results.mjs';
import { queryKnowledge, querySop, knowledgeFiles } from './knowledge.mjs';
export { queryKnowledge } from './knowledge.mjs';

const string = { type: 'string', minLength: 1 };
const object = properties => ({ type: 'object', properties, additionalProperties: false });
const compactBenchmark = result => ({ directory: result.directory, run_id: result.run_id, status: result.status,
  case_count: result.case_count, family_count: result.family_count, counts: result.counts, duration_ms: result.duration_ms,
  model_api_calls: result.model_api_calls, report: path.join(result.directory, 'REPORT.md'),
  cases: result.cases.map(item => ({ id: item.id, acceptance: item.acceptance, directory: item.directory, duration_ms: item.duration_ms })) });
export function artifactPath(root, value) {
  const base = fs.realpathSync(path.join(root, 'artifacts'));
  const target = fs.realpathSync(path.resolve(root, value));
  const relative = path.relative(base, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Evidence path must stay inside workspace artifacts');
  return target;
}
export function doctor(root) {
  const vivado = path.join(process.env.EDA_VIVADO_BIN || 'E:\\Xilinx\\Vivado\\2020.2\\bin', 'vivado.bat');
  const ltspice = path.join(root, 'runtime/ltspice/LTspice.exe');
  return { schema_version: 1, node: process.version, pi: '1.3.0', workspace: root,
    config: readConfig(root), vivado: { path: vivado, exists: fs.existsSync(vivado) },
    ltspice: { path: ltspice, exists: fs.existsSync(ltspice) },
    provider: { model_api_enabled: readConfig(root).model_api_enabled, key_present: Boolean(process.env.DEEPSEEK_API_KEY), key_value_recorded: false },
    mcp_config_exists: fs.existsSync(path.join(root, '.pi/mcp.json')),
    knowledge_present: fs.existsSync(path.join(root, 'knowledge/rules.json')),
    validation_boundary: 'File availability only; a real run is required to prove licenses, process startup and acceptance.' };
}
export function createPlatformTools(root) {
  const definitions = [
    { name: 'eda_knowledge', label: 'FPGA rules and sources', description: 'Rank local FPGA rules using English terms and Chinese bigrams, or retrieve an exact rule ID. Returns source versions, applicability, required evidence and corpus hashes. Lexical retrieval only; no embeddings, model or internet call.',
      parameters: object({ query: {...string,maxLength:2048}, id: string, limit: { type: 'integer', minimum: 1, maximum: 40 },classification:{type:'string',enum:['rule','recommendation','limitation']},source_id:string }),
      run: args => queryKnowledge(root, args) },
    { name: 'eda_sop', label: 'FPGA operating procedures', description: 'List local FPGA SOPs or load one by ID with its full procedure, referenced rules, required evidence and file hashes. Guidance is advisory; declared workflow checks enforce acceptance. No EDA or model call.',
      parameters: object({id:string}), run:args=>querySop(root,args) },
    { name: 'eda_trace', label: 'Inspect experiment evidence', description: 'Offline inspect, recovery-check or OTLP JSON export for native/proxy/optimizer traces. Checks hashes, parents, committed state and ownership. Export writes a local file only; never uploads, resumes EDA or infers functional acceptance.',
      parameters: { ...object({ directory: string, action: { type:'string',enum:['inspect','recovery-check','export'] } }), required: ['directory'] },
      run: args => {
        if (args.action === 'export') {
          const {payload,summary} = exportTraces([artifactPath(root,args.directory)]);
          const dir=fs.mkdtempSync(path.join(root,'artifacts/trace-export-'));
          const output=path.join(dir,'otlp.json');fs.writeFileSync(output,JSON.stringify(payload,null,2));
          fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(summary,null,2));
          return {...summary,output};
        }
        if (args.action === 'recovery-check') {
          const {journal, ...summary} = prepareRecovery(root,artifactPath(root,args.directory));
          return summary;
        }
        return inspectTrace(artifactPath(root, args.directory));
      } },
    { name: 'eda_runs', label: 'Runtime job states', description: 'List persistent runtime jobs. Explicit reconcile archives leases only when their owner and recorded children are absent; never kills or reruns a job.',
      parameters: { ...object({ action: { enum: ['list', 'reconcile'], type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } }), required: ['action'] },
      run: args => {
        if (args.action === 'reconcile') return { recovery: reconcileRuns(root) };
        const runs = listRuns(root), counts = {};
        for (const run of runs) counts[run.status] = (counts[run.status] || 0) + 1;
        return { total: runs.length, counts, runs: runs.slice(0, args.limit ?? 20) };
      } },
    { name: 'eda_preflight', label: 'Local capabilities', description: 'Inspect local EDA capability paths, runtime configuration and model API policy. Availability is not a successful validation.',
      parameters: object({}), run: () => doctor(root) },
    { name: 'eda_benchmark', label: 'EDA benchmark campaign', description: 'List, plan, execute, report or compare versioned local benchmarks. Real EDA runs use global resource limits, frozen acceptance and per-case traces. Seeds are variants, not independent tasks.',
      parameters: { ...object({ action: { type: 'string', enum: ['list', 'plan', 'run', 'report', 'compare'] }, category: string,
        tier: string, tool: string, ids: { type: 'array', items: string, minItems: 1 }, seed: { type: 'integer', minimum: 0 },
        concurrency: { type: 'integer', minimum: 1, maximum: 4 }, directory: string, baseline: string, candidate: string }), required: ['action'] },
      run: async (args, signal) => {
        const bench = await import('./bench/index.mjs');
        const options = { ...args, root, signal };
        if (args.action === 'list') {
          const listed = bench.listCases(options);
          return { ...listed, cases: listed.cases.map(({ id, family, variant, category, tier, tool, origin, availability, seed }) => ({ id, family, variant, category, tier, tool, origin, availability, seed })) };
        }
        if (args.action === 'plan') return bench.planBenchmark(options);
        if (args.action === 'run') return compactBenchmark(await bench.runBenchmark(options));
        if (args.action === 'report') return compactBenchmark(bench.reportBenchmark(artifactPath(root, args.directory)));
        if (args.action === 'compare') return bench.compareRuns(artifactPath(root, args.baseline), artifactPath(root, args.candidate));
        throw new Error('Unknown benchmark action');
      } },
  ];
  definitions.push(...platformSurfaces.map(s=>{
    const original=definitions.find(d=>d.name===s.base);
    return {name:s.name,label:s.name,description:s.purpose,parameters:specializeSchema(original.parameters,s.fields,s.required),base:s.base,fixed:s.fixed,run:original.run};
  }),...historyDefinitions(root));
  return definitions.map(({ run, base, fixed, ...tool }) => ({ ...tool, async execute(id, args, signal, _update, ctx) {
    const trace = createTrace({ root, tool: tool.name, args, toolCallId: id, context: ctx?.edaTraceContext });
    trace.capture(path.join(root, 'src/platform.mjs'), 'orchestrator');
    try {
      const operation=base||tool.name;
      args={...args,...fixed};
      signal?.throwIfAborted();
      const inputs = ['eda_knowledge','eda_sop'].includes(operation) ? knowledgeFiles(root)
        : operation === 'eda_preflight' ? ['.eda/config.json']
        : operation.startsWith('eda_results_') ? ['src/results.mjs','results/catalog.json']
        : operation === 'eda_benchmark' ? ['benchmarks/catalog.json', 'src/bench/index.mjs', 'src/bench/runner.mjs', 'src/bench/compare.mjs'] : ['src/runtime.mjs'];
      trace.capture(path.join(root,'src/tools/focused.mjs'),'tool_contract');
      for (const file of inputs) trace.capture(path.resolve(root, file), 'query_input');
      if (operation.startsWith('eda_results_')) {
        for (const id of [args.id,args.baseline,args.candidate].filter(Boolean)) {
          for (const item of getResult(root,id).evidence) {
            for (const name of [item.path,item.original_path]) {
              const file=resultPath(root,name); if(fs.existsSync(file))trace.capture(file,'historical_evidence');
            }
          }
        }
      }
      if (operation === 'eda_benchmark' && ['report', 'compare'].includes(args.action)) {
        for (const dir of [args.directory, args.baseline, args.candidate].filter(Boolean)) trace.capture(path.join(artifactPath(root, dir), 'summary.json'), 'benchmark_summary');
      }
      if (operation === 'eda_trace') {
        const dir = artifactPath(root, args.directory);
        for (const file of ['scripts/trace-inspect.mjs', 'src/optimizer-inspection.mjs', 'src/optimizer-recovery.mjs', 'src/trace-export.mjs', 'src/trace.mjs']) trace.capture(path.join(root, file), 'inspector');
        for (const file of ['run.json', 'events.jsonl', 'optimizer-result.json', 'optimizer-events.jsonl', 'best.json',
          'optimizer/optimizer-result.json', 'optimizer/optimizer-events.jsonl', 'optimizer/best.json', 'recovery.json', 'optimizer/recovery.json']) {
          if (fs.existsSync(path.join(dir, file))) trace.capture(path.join(dir, file), 'inspected_evidence');
        }
      }
      trace.finalizeDependencies();
      const result = await run(args, signal);
      fs.writeFileSync(path.join(trace.directory, 'result.json'), JSON.stringify(result, null, 2));
      const receipt = trace.finish('completed');
      const data = { ...result, evidence: receipt.directory };
      return { content: [{ type: 'text', text: JSON.stringify(data) }], details: data };
    } catch (error) {
      const receipt = trace.finish(signal?.aborted ? 'cancelled' : 'failed', error);
      throw Object.assign(new Error(`${String(error)}; evidence: ${trace.directory}`), { receipt });
    }
  } }));
}
