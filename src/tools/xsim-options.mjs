import fs from 'node:fs';
import path from 'node:path';

export function validateXsimOptions(root,args) {
  for (const field of ['include_dirs','defines','generics','libraries','plusargs']) {
    if (args[field]!==undefined && (!Array.isArray(args[field]) || args[field].length>256 || args[field].some(v=>typeof v!=='string'||!v||v.length>2048||/[\x00-\x1f]/.test(v)))) throw new Error(`Invalid XSim ${field}`);
  }
  for (const directory of args.include_dirs||[]) {
    const real=fs.realpathSync(path.resolve(root,directory)),rel=path.relative(fs.realpathSync(root),real);
    if (rel==='..'||rel.startsWith(`..${path.sep}`)||path.isAbsolute(rel)||!fs.statSync(real).isDirectory()) throw new Error('Include directory outside workspace or not a directory');
  }
  for (const field of ['defines','generics']) if (args[field]?.some(v=>! /^[A-Za-z_][A-Za-z0-9_$]*(?:=.+)?$/.test(v))) throw new Error(`Invalid XSim ${field}`);
  if (args.generics?.some(v=>!v.includes('='))) throw new Error('Top parameter must use NAME=value');
  if (args.libraries?.some(v=>! /^[A-Za-z_][A-Za-z0-9_]*$/.test(v))) throw new Error('Use installed library names, not implicit external directories');
  if (args.plusargs?.some(v=>! /^[A-Za-z_][A-Za-z0-9_]*(?:=.+)?$/.test(v))) throw new Error('plusargs use NAME or NAME=value, without a leading +');
  for (const [field,min,max] of [['sv_seed',0,2147483647],['timeout_seconds',1,1800]]) if (args[field]!==undefined&&(!Number.isInteger(args[field])||args[field]<min||args[field]>max)) throw new Error(`Invalid XSim ${field}`);
  if (args.pass_marker!==undefined&&(typeof args.pass_marker!=='string'||!args.pass_marker.trim()||args.pass_marker.length>256||/[\x00-\x1f]/.test(args.pass_marker))) throw new Error('Invalid pass_marker');
  if (args.sources.some(s=>! /\.(v|sv|vhd|vhdl)$/i.test(s))) throw new Error('XSim sources require RTL file extensions');
}

export function xsimCommands(root,args) {
  validateXsimOptions(root,args);
  const pairs=(flag,values=[])=>values.flatMap(v=>[flag,v]);
  const libraries=pairs('-L',args.libraries);
  const verilog=args.sources.filter(s=>/\.(v|sv)$/i.test(s)).map(s=>path.resolve(root,s));
  const vhdl=args.sources.filter(s=>/\.(vhd|vhdl)$/i.test(s)).map(s=>path.resolve(root,s));
  return {compile:[
    ...(vhdl.length?[{exe:'xvhdl.bat',args:[...(args.vhdl_2008?['--2008']:[]),...libraries,...vhdl]}]:[]),
    ...(verilog.length?[{exe:'xvlog.bat',args:['--sv',...pairs('-i',(args.include_dirs||[]).map(d=>path.resolve(root,d))),...pairs('-d',args.defines),...libraries,...verilog]}]:[]),
  ],elaborate:[args.top,'-s','eda_snapshot','-debug','typical','-mt','2',...libraries,...pairs('--generic_top',args.generics)],
  simulate:['eda_snapshot',...pairs('--testplusarg',args.plusargs),...(args.sv_seed===undefined?[]:['--sv_seed',String(args.sv_seed)]),...(args.capture_top_wave?['-tclbatch','waves.tcl']:['-runall'])]};
}

export function simulationAcceptance(transcript,marker) {
  const failure=/(?:^|\n)\s*(?:Fatal:|FATAL\b|ERROR:|(?:[A-Z0-9_]*_)?(?:FAIL|TIMEOUT)\b)/im.test(transcript);
  const completed=/\$finish called at time|Simulation complete/i.test(transcript);
  const hits=marker?transcript.split(/\r?\n/).filter(line=>line===marker||line.startsWith(marker+' ')).length:0;
  return {status:failure?'fail':!marker?'not_evaluated':hits===1&&completed?'pass':'incomplete',pass_marker:marker??null,marker_matches:hits,completion_observed:completed,failure_diagnostic:failure,scope:'Explicit testbench marker, completion and diagnostic checks; semantic assertions remain the testbench responsibility.'};
}
