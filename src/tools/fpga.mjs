import fs from 'node:fs';
import path from 'node:path';
import { runProcess } from '../trace.mjs';
import { fpgaSurfaces } from './focused.mjs';
import { specializeSchema } from '../tool-contracts.mjs';

const str = { type: 'string', minLength: 1, maxLength: 1024 };
const strings = { type: 'array', items: str, maxItems: 256 };
const choice = values => ({ type: 'string', enum: values });
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const limit = { type: 'integer', minimum: 1, maximum: 200, default: 20 };
const reportNames = ['timing', 'utilization', 'cdc', 'drc', 'methodology', 'clocks', 'exceptions', 'route'];
const definitions = [
  ['eda_vivado_catalog', 'Vivado device and IP catalog', 'Query the installed Vivado version, available commands, parts or IP VLNVs. Bounded results include total match count; availability is not execution proof.', schema({ kind: choice(['commands','parts','ips']), pattern: str, limit }, ['kind'])],
  ['eda_vivado_synthesize', 'Vivado RTL synthesis', 'Synthesize explicit RTL/XCI sources and XDC into a fresh checkpoint. Supports include directories, defines and top parameters. Defaults to out-of-context; no implicit clocks or timing relaxation. Produces utilization and black-box evidence.', schema({ sources: { ...strings, minItems: 1 }, constraints: strings, top: str, part: str, mode: choice(['out_of_context','default']), include_dirs: strings, defines: strings, generics: strings, vhdl_2008: { type:'boolean' } }, ['sources','top','part'])],
  ['eda_vivado_implement', 'Vivado checkpoint implementation', 'Open a synthesis checkpoint, optionally apply explicit additional XDC, and run opt/place/route in a fresh directory. Returns routed DCP, timing, route and constraint evidence. Tool completion is separate from timing closure or board signoff.', schema({ checkpoint: str, constraints: strings }, ['checkpoint'])],
  ['eda_vivado_reports', 'Vivado design diagnostics', 'Generate selected timing, CDC, DRC, methodology, clock, exception, route and utilization reports from a checkpoint. Unknown report formats remain unknown; CDC warnings and missing IO constraints require review.', schema({ checkpoint: str, reports: { type:'array', items:choice(reportNames), minItems:1, uniqueItems:true } }, ['checkpoint','reports'])],
  ['eda_vivado_objects', 'Vivado netlist objects', 'Inspect bounded matching cells, nets, ports, pins or clocks in a checkpoint. Returns names and selected properties plus total count; query text is passed as data, never evaluated as Tcl.', schema({ checkpoint: str, kind: choice(['cells','nets','ports','pins','clocks']), pattern:str, limit }, ['checkpoint','kind'])],
  ['eda_vivado_timing_paths', 'Vivado critical timing paths', 'Return setup or hold timing paths with endpoint, slack, requirement and logic depth. Optional from/to clock names must resolve exactly. A bounded path listing does not establish whole-design TNS or signoff.', schema({ checkpoint: str, delay_type:choice(['max','min']), from_clock:str, to_clock:str, limit }, ['checkpoint'])],
];

// Quote one Tcl word. Never interpolate a user value as executable Tcl.
export function tclWord(value) {
  if (typeof value !== 'string' || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error('Invalid Tcl string');
  return '"' + value.replace(/[\\"$\[\]\n\r\t]/g, c => ({'\\':'\\\\','"':'\\"','$':'\\$','[':'\\[',']':'\\]','\n':'\\n','\r':'\\r','\t':'\\t'}[c])) + '"';
}
const tclList = values => `[list ${values.map(tclWord).join(' ')}]`;
function inside(root, value, directory=false) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('Expected a workspace path');
  const lexical=path.relative(path.resolve(root),path.resolve(root,value));
  if(lexical==='..'||lexical.startsWith(`..${path.sep}`)||path.isAbsolute(lexical))throw new Error('Input must remain inside the EDA workspace');
  const file=fs.realpathSync(path.resolve(root,value)), relative=path.relative(fs.realpathSync(root),file);
  if (relative==='..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || (!relative && !directory)) throw new Error('Input must remain inside the EDA workspace');
  if (!(directory ? fs.statSync(file).isDirectory() : fs.statSync(file).isFile())) throw new Error('Wrong input path type');
  return file.replaceAll('\\','/');
}
function checkShape(value, spec, label='arguments') {
  if (spec.type==='object') {
    if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error(`${label}: expected object`);
    for (const key of Object.keys(value)) if (!(key in spec.properties)) throw new Error(`${label}: unexpected field ${key}`);
    for (const key of spec.required||[]) if (!(key in value)) throw new Error(`${label}: missing ${key}`);
    for (const [key,v] of Object.entries(value)) checkShape(v,spec.properties[key],key);
  } else if (spec.type==='array') {
    if (!Array.isArray(value) || value.length<(spec.minItems||0) || value.length>(spec.maxItems||256)) throw new Error(`${label}: invalid array`);
    if (spec.uniqueItems && new Set(value).size!==value.length) throw new Error(`${label}: duplicates`);
    value.forEach(v=>checkShape(v,spec.items,label));
  } else if (spec.type==='integer') {
    if (!Number.isInteger(value) || value<spec.minimum || value>spec.maximum) throw new Error(`${label}: invalid integer`);
  } else if (typeof value!==spec.type || (spec.type==='string' && (!value || value.length>(spec.maxLength||1024) || /[\x00-\x1f]/.test(value)))) throw new Error(`${label}: invalid ${spec.type}`);
  if (spec.enum && !spec.enum.includes(value)) throw new Error(`${label}: unsupported value`);
}
export function normalizeFpgaArgs(root,name,args) {
  const definition=definitions.find(d=>d[0]===name);
  if (!definition) throw new Error(`Unknown FPGA tool: ${name}`);
  checkShape(args,definition[3]);
  const normalized={...args};
  if (args.checkpoint) {
    normalized.checkpoint=inside(root,args.checkpoint);
    if (!/\.dcp$/i.test(normalized.checkpoint)) throw new Error('Expected a .dcp checkpoint');
  }
  for (const field of ['sources','constraints']) if (args[field]) normalized[field]=args[field].map(f=>inside(root,f));
  if (args.constraints?.some(f=>!f.toLowerCase().endsWith('.xdc'))) throw new Error('Constraints must be .xdc files');
  if (args.sources?.some(f=>! /\.(v|sv|vhd|vhdl|xci)$/i.test(f))) throw new Error('Sources must be Verilog, SystemVerilog, VHDL or XCI');
  if (args.include_dirs) normalized.include_dirs=args.include_dirs.map(f=>inside(root,f,true));
  for (const field of ['defines','generics']) if (args[field]?.some(v=>! /^[A-Za-z_][A-Za-z0-9_$]*(?:=[^\r\n]+)?$/.test(v))) throw new Error(`Invalid ${field}`);
  if (args.generics?.some(v=>!v.includes('='))) throw new Error('Top parameters must use NAME=value');
  if (args.top && !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(args.top)) throw new Error('Invalid RTL top');
  if (args.part && !/^[A-Za-z0-9_-]+$/.test(args.part)) throw new Error('Invalid part');
  return normalized;
}

export function makeFpgaTcl(name,a,helper) {
  const lines=[`source ${tclWord(helper.replaceAll('\\','/'))}`, 'set_param general.maxThreads 2', 'set_param synth.maxThreads 1'];
  const q=tclWord;
  if (name==='eda_vivado_catalog') lines.push(`eda::catalog ${q(a.kind)} ${q(a.pattern||'*')} ${a.limit||20}`);
  else if (name==='eda_vivado_synthesize') {
    lines.push(`create_project -in_memory -part ${q(a.part)}`);
    for (const [field,property] of [['include_dirs','include_dirs'],['defines','verilog_define'],['generics','generic']]) if (a[field]?.length) lines.push(`set_property ${property} ${tclList(a[field])} [current_fileset]`);
    for (const source of a.sources) lines.push(/\.xci$/i.test(source) ? `read_ip ${q(source)}` : /\.(vhd|vhdl)$/i.test(source) ? `read_vhdl ${a.vhdl_2008 ? '-vhdl2008 ' : ''}${q(source)}` : `read_verilog ${/\.sv$/i.test(source)?'-sv ':''}${q(source)}`);
    for (const xdc of a.constraints||[]) lines.push(`read_xdc ${q(xdc)}`);
    lines.push(`synth_design -top ${q(a.top)} -part ${q(a.part)}${a.mode==='default'?'':' -mode out_of_context'}`, 'write_checkpoint -force synthesized.dcp', 'write_xdc -force applied-constraints.xdc', 'eda::reports [list utilization timing] synthesized', 'if {[llength [get_cells -hier -quiet -filter {IS_BLACKBOX == 1}]]} {error "EDA_UNRESOLVED_BLACKBOX"}');
  } else {
    lines.push(`open_checkpoint ${q(a.checkpoint)}`);
    if (name==='eda_vivado_implement') {
      for (const xdc of a.constraints||[]) lines.push(`read_xdc ${q(xdc)}`);
      lines.push('opt_design','place_design','route_design','write_checkpoint -force routed.dcp','write_xdc -force applied-constraints.xdc','eda::reports [list timing utilization route drc] routed');
    } else if (name==='eda_vivado_reports') lines.push(`eda::reports ${tclList(a.reports)} checkpoint_analysis`, 'write_xdc -force applied-constraints.xdc');
    else if (name==='eda_vivado_objects') lines.push(`eda::objects ${q(a.kind)} ${q(a.pattern||'*')} ${a.limit||20}`);
    else lines.push(`eda::paths ${q(a.delay_type||'max')} ${a.limit||20} ${q(a.from_clock||'')} ${q(a.to_clock||'')}`);
  }
  return lines.join('\n')+'\nputs "EDA_FPGA_TOOL_COMPLETE"\n';
}

export function parseFpgaReports(texts={}) {
  const timingChecks={};
  for (const m of (texts.check_timing||'').matchAll(/checking\s+(\w+)\s+\((\d+)\)/g)) {
    if (timingChecks[m[1]]!==undefined && timingChecks[m[1]]!==Number(m[2])) throw new Error('Inconsistent check_timing counts');
    timingChecks[m[1]]=Number(m[2]);
  }
  const routeValue=label=>{
    const m=(texts.route||'').match(new RegExp(`# of ${label}\\.+\\s*:\\s*(\\d+)\\s*:`));
    return m?Number(m[1]):null;
  };
  const route={routable:routeValue('routable nets'),fully_routed:routeValue('fully routed nets'),errors:routeValue('nets with routing errors')};
  route.status=Object.values(route).some(v=>v===null)?'unknown':route.routable===route.fully_routed&&route.errors===0?'pass':'fail';
  const utilization={};
  for (const m of (texts.utilization||'').matchAll(/^\|\s*(Slice LUTs\*?|CLB LUTs\*?|Slice Registers|CLB Registers|Block RAM Tile|RAMB36\/FIFO\*?|RAMB18|DSPs)\s*\|\s*([\d.]+)\s*\|/gm)) utilization[m[1].replace(/^(Slice|CLB) LUTs\*$/,'$1 LUTs')]=Number(m[2]);
  const cdc=[];
  for (const line of (texts.cdc||'').split(/\r?\n/)) {
    const m=line.match(/^\s*(?:\|\s*)?(CDC-\d+)\s+(?:\|\s*)?(Critical|Warning|Info)\s+(?:\|\s*)?(\d+)\s*(?:\|\s*)?(.*)/i);
    if (m) cdc.push({rule:m[1],severity:m[2],count:Number(m[3]),description:m[4].trim().replace(/\|\s*$/,'')});
  }
  return {timing_checks:timingChecks,route,utilization,cdc_rules:cdc,cdc_format_recognized:cdc.length>0};
}
export function assessFpga(raw,parsed) {
  const finite=Number.isFinite;
  const setup=raw.setup_slack_ns,hold=raw.hold_slack_ns;
  const clockNames=['no_clock','unconstrained_internal_endpoints','multiple_clock','generated_clocks','loops','latch_loops'];
  const ioNames=['no_input_delay','no_output_delay','partial_input_delay','partial_output_delay'];
  const counts=parsed.timing_checks;
  const status=names=>names.some(k=>!Number.isInteger(counts[k]))?'unknown':names.some(k=>counts[k]>0)?'review_required':'pass';
  return {setup_hold:!finite(setup)||!finite(hold)?'unknown':setup<0||hold<0?'fail':'pass',clock_and_internal_constraints:status(clockNames),io_constraints:status(ioNames),routing:parsed.route.status,
    cdc:!parsed.cdc_format_recognized?'unknown':parsed.cdc_rules.some(x=>x.severity.toLowerCase()==='critical'&&x.count>0)?'fail':parsed.cdc_rules.some(x=>x.severity.toLowerCase()==='warning'&&x.count>0)?'review_required':'no_reported_warning',
    overall_design_acceptance:'not_evaluated',board_signoff:false,scope:'Per-report diagnostics only. Positive setup/hold slack does not validate CDC, IO timing, functional correctness or hardware.'};
}

export function createFpgaTools(root,tracedExecute) {
  const helper=path.join(root,'src/tools/vivado-common.tcl');
  const vivado=path.join(process.env.EDA_VIVADO_BIN||'E:\\Xilinx\\Vivado\\2020.2\\bin','vivado.bat');
  const surfaces = [...definitions.map(d=>[...d, d[0], {}]), ...fpgaSurfaces.map(s=>{
    const base=definitions.find(d=>d[0]===s.base);
    return [s.name,s.name,s.purpose,specializeSchema(base[3],s.fields,s.required),s.base,s.fixed];
  })];
  return surfaces.map(([name,label,description,parameters,base,fixed])=>({name,label,description,parameters,
    execute:tracedExecute(name,async(trace,args,signal,onUpdate)=>{
      const a=normalizeFpgaArgs(root,base,{...args,...fixed});
      const script=path.join(trace.directory,'operation.tcl');
      fs.writeFileSync(script,makeFpgaTcl(base,a,helper));trace.capture(script,'generated_tcl');
      await runProcess(trace,vivado,['-mode','batch','-notrace','-source',script,'-log','vivado.log','-journal','vivado.jou'],{signal,update:onUpdate});
      const result=JSON.parse(fs.readFileSync(path.join(trace.directory,'fpga-result.json'),'utf8'));
      const texts={};
      for (const [key,file] of Object.entries({check_timing:'check-timing.rpt',route:'route.rpt',utilization:'utilization.rpt',cdc:'cdc.rpt'})) if (fs.existsSync(path.join(trace.directory,file))) texts[key]=fs.readFileSync(path.join(trace.directory,file),'utf8');
      const parsed=parseFpgaReports(texts);
      const artifactNames=fs.readdirSync(trace.directory).filter(f=>/\.(rpt|dcp|xdc)$/.test(f));
      const details={...result,parsed_reports:parsed,assessment:assessFpga(result,parsed),artifacts:Object.fromEntries(artifactNames.map(f=>[f,path.join(trace.directory,f)])),model_api_calls:0};
      fs.writeFileSync(path.join(trace.directory,'fpga-summary.json'),JSON.stringify(details,null,2)+'\n');
      return {fpga:details};
    },{resource:'vivado',executable:vivado,validate:args=>normalizeFpgaArgs(root,base,{...args,...fixed}),capture:(trace,args)=>{
      for (const file of ['src/tools/fpga.mjs','src/tools/focused.mjs','src/tools/vivado-common.tcl',...(args.constraints||[]),args.checkpoint].filter(Boolean)) trace.capture(file,'fpga_input');
      // Referenced headers are captured using include_dirs; do not scan entire trees.
      trace.finalizeDependencies();
    }})
  }));
}
