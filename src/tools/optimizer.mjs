import fs from 'node:fs';
import path from 'node:path';
import { runProcess } from '../trace.mjs';
import { prepareRecovery } from '../optimizer-recovery.mjs';

const plays = ['route_explore','route_aggressive','route_more_global','rebuild_route','replace_explore','replace_timing','replace_netdelay'];
export function compactOptimizerResult(result, resultFile) {
  const metrics = value => value ? Object.fromEntries(Object.entries(value).filter(([key])=>key!=='ports')) : value;
  return {...result,result_file:resultFile,baseline:metrics(result.baseline),
    best:result.best ? {...result.best,metrics:metrics(result.best.metrics)} : result.best,
    attempts:result.attempts.map(attempt=>({...attempt,metrics:metrics(attempt.metrics)}))};
}
export function createOptimizerTools(root, tracedExecute) {
  const python = path.join(root, 'runtime/vivado-community-venv/Scripts/python.exe');
  const vivado = path.join(process.env.EDA_VIVADO_BIN || 'E:\\Xilinx\\Vivado\\2020.2\\bin', 'vivado.bat');
  const name = 'eda_vivado_optimize';
  const parameters = { type:'object', additionalProperties:false, anyOf:[{required:['checkpoint']},{required:['resume_from']}], properties:{
    checkpoint:{type:'string',minLength:1}, mode:{type:'string',enum:['plan','run'],default:'plan'},
    resume_from:{type:'string',minLength:1,description:'Native interrupted optimizer run directory. Continues in a fresh run after ownership/hash checks and independent remeasurement.'},
    max_trials:{type:'integer',minimum:1,maximum:7,default:3}, max_seconds:{type:'integer',minimum:60,maximum:3600,default:600},
    min_gain_ns:{type:'number',minimum:0.001,maximum:1,default:0.01}, first_play:{type:'string',enum:plays},
  }};
  const validate = args => {
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k=>!(k in parameters.properties))) throw new Error('Invalid optimizer arguments');
    let normalized = {...args};
    if (args.resume_from !== undefined) {
      if (typeof args.resume_from !== 'string' || args.checkpoint !== undefined || args.first_play !== undefined || args.mode === 'plan') throw new Error('Recovery accepts resume_from with run mode; no checkpoint/first_play override');
      const checked = prepareRecovery(root,args.resume_from);
      if (!checked.ready) throw new Error(`Recovery blocked: ${checked.issues.join('; ')}`);
      if (args.min_gain_ns !== undefined && args.min_gain_ns !== checked.journal.request.min_gain_ns) throw new Error('Recovery cannot change acceptance threshold');
      normalized = {...args,mode:'run',checkpoint:checked.journal.baseline.checkpoint,min_gain_ns:checked.journal.request.min_gain_ns};
    }
    if (typeof normalized.checkpoint !== 'string') throw new Error('checkpoint or resume_from is required');
    const input = fs.realpathSync(path.resolve(root,normalized.checkpoint));
    const rel = path.relative(fs.realpathSync(root),input);
    if (rel==='..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) || !fs.statSync(input).isFile() || !/\.dcp$/i.test(input)) throw new Error('Expected a workspace DCP');
    for (const k of ['max_trials','max_seconds']) if (args[k]!==undefined && (!Number.isInteger(args[k]) || args[k]<parameters.properties[k].minimum || args[k]>parameters.properties[k].maximum)) throw new Error(`Invalid ${k}`);
    if (args.min_gain_ns!==undefined && (!Number.isFinite(args.min_gain_ns) || args.min_gain_ns<0.001 || args.min_gain_ns>1)) throw new Error('Invalid min_gain_ns');
    if (args.mode!==undefined && !['plan','run'].includes(args.mode)) throw new Error('Invalid mode');
    if (args.first_play!==undefined && !plays.includes(args.first_play)) throw new Error('Unknown first_play');
    if (!fs.existsSync(vivado)) throw new Error('Vivado executable missing');
    return {...normalized,checkpoint:input};
  };
  return [{name,label:'Measured Vivado optimization',parameters,
    description:'Provider-free RouteAgents routing plus bounded Vivado candidate loop and AER plateau stopping. Default plan measures a routed DCP; run tries physical recipes. resume_from continues an interrupted run from a verified committed journal in a fresh directory after baseline/winner remeasurement; run recovery-check first. Preserves constraints, logical representation, routing/hold/DRC gates; reports gain and rejections. No formal/board signoff. Shared lease and causal traces.',
    execute:tracedExecute(name,async(trace,args,signal,update)=>{
      const request = path.join(trace.directory,'optimizer-request.json');
      const normalized = validate(args);
      delete normalized.resume_from;
      fs.writeFileSync(request,JSON.stringify(normalized,null,2));
      const out=path.join(trace.directory,'optimizer');
      const context=path.join(trace.directory,'optimizer-trace-context.json');
      fs.writeFileSync(context,JSON.stringify({trace_id:trace.manifest.trace_id,parent_span_id:trace.manifest.span_id,parent_run_id:trace.manifest.run_id}));
      trace.event('optimizer_link',{directory:out,events_file:path.join(out,'optimizer-events.jsonl')});
      const recoveryArgs = [];
      if (args.resume_from) {
        const checked = prepareRecovery(root,args.resume_from);
        if (!checked.ready) throw new Error(`Recovery blocked: ${checked.issues.join('; ')}`);
        const file = path.join(trace.directory,'optimizer-recovery-input.json');
        fs.writeFileSync(file,JSON.stringify(checked,null,2));
        recoveryArgs.push('--recovery',file);
        trace.event('recovery_link',{source_run_id:checked.source_run_id,source_directory:checked.source_directory});
      }
      await runProcess(trace,python,[path.join(root,'scripts/optimize-vivado.py'),'--request',request,'--output',out,'--vivado',vivado,'--trace-context',context,...recoveryArgs],
        {signal,update,timeoutMs:((args.max_seconds||600)+90)*1000});
      const result=JSON.parse(fs.readFileSync(path.join(out,'optimizer-result.json'),'utf8'));
      if (!['completed','planned'].includes(result.status) || result.input_unchanged!==true) throw new Error(`Optimizer failed: ${result.status}`);
      return {optimizer:compactOptimizerResult(result,path.join(out,'optimizer-result.json'))};
    },{resource:'vivado',executable:python,validate,capture:(trace,args)=>{
      const normalized=validate(args);
      for (const file of [normalized.checkpoint,'src/tools/optimizer.mjs','src/optimizer-recovery.mjs','scripts/optimize-vivado.py','src/fpga_optimizer/core.py','src/fpga_optimizer/backend.py','src/fpga_optimizer/runner.py','src/fpga_optimizer/trace.py','src/fpga_optimizer/recovery.py','src/tools/vivado-common.tcl','src/vivado_workbench.py','.eda/optimizer-upstreams.json','vendor/routeagents-fpl26/optimizer/recipe_router.py']) trace.capture(file,'optimizer_input');
      if (args.resume_from) {
        const checked=prepareRecovery(root,args.resume_from);
        for (const file of [path.join(checked.source_directory,'recovery.json'),checked.journal.best.checkpoint]) trace.capture(file,'recovery_input');
      }
      trace.finalizeDependencies();
    }})}];
}
