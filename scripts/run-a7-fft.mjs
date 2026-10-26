// Complete FFT integration regression using the native EDA tools, no model API.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createJiti} from 'jiti';
import {parseFpgaReports,assessFpga,tclWord} from '../src/tools/fpga.mjs';
const root=path.resolve(import.meta.dirname,'..');
const relative=f=>path.relative(root,f).replaceAll('\\','/');
const digest=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const write=(f,j)=>fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n');
const folder=path.join(root,'artifacts',`a7-fft-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,6)}`);
fs.mkdirSync(folder,{recursive:true});
const design=path.join(folder,'candidate');
const original=path.join(root,'projects/fft-spectrum');
const fixed=read(path.join(original,'acceptance-hashes.json'));
for(const [file,sha]of Object.entries(fixed))if(digest(path.join(root,file))!==sha)throw Error(`Frozen FFT oracle changed: ${file}`);
const files=['rtl/spectrum_core.v','tb_spectrum.sv','oracle.py','create-ip.tcl','vectors/input.hex','check-negative-controls.py'];
for(const name of files){const target=path.join(design,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(original,name),target);}
const dependencies=[...files.map(n=>path.join(design,n)),path.join(root,'vendor/SynthPilot_Tutorial/prj/04/rtl/magnitude_calc.v'),path.join(root,'projects/a7-validation/ooc-context.tcl')];
const input_hashes=Object.fromEntries(dependencies.map(f=>[relative(f),digest(f)]));
const registry=new Map();(await createJiti(import.meta.url).import('../src/extension.ts',{default:true}))({registerTool:t=>registry.set(t.name,t)});
const abort=new AbortController();process.on('SIGINT',()=>abort.abort());
const result={schema_version:1,case:'a7-fft-1024',execution:'codex_native_tool_pipeline',started_at:new Date().toISOString(),status:'running',input_hashes,model_api_calls:0,formal:'not_evaluated',hardware:'not_evaluated',runs:{}};
write(path.join(folder,'result.json'),result);
try {
 for(const stage of ['simulate','implement']){
  let script=fs.readFileSync(path.join(original,`${stage}.tcl`),'utf8');
  script=script.replace('set design [file join $root projects fft-spectrum]',`set design ${tclWord(design.replaceAll('\\','/'))}`);
  if(stage==='implement'){
   script=script.replace('opt_design','source [file join $root projects a7-validation ooc-context.tcl]\nopt_design');
   script=script.replace('write_checkpoint -force spectrum-routed.dcp','');
   script=script.replace('route_design','route_design\nreport_route_status -file route-in-memory.rpt\nwrite_checkpoint -force spectrum-routed.dcp\nclose_design\nopen_checkpoint spectrum-routed.dcp');
  }
  const file=path.join(folder,`${stage}.tcl`);fs.writeFileSync(file,script);
  const r=await registry.get('eda_vivado').execute(`a7-fft-${stage}-${randomUUID()}`,{script:relative(file),dependencies:dependencies.map(relative)},abort.signal);
  if(r.isError||r.details?.status!=='completed')throw Error(`FFT ${stage} did not complete`);
  result.runs[stage]=r.details.directory;write(path.join(folder,'result.json'),result);
 }
 const sim=result.runs.simulate,impl=result.runs.implement;
 const oracle=read(path.join(sim,'oracle-result.json')),physical=read(path.join(impl,'build-result.json'));
 execFileSync(process.env.EDA_PYTHON||'python',[path.join(design,'check-negative-controls.py'),path.join(sim,'spectrum.csv')],{cwd:root,stdio:['ignore',fs.openSync(path.join(folder,'negative-controls.log'),'w'),'pipe']});
 const negative=read(path.join(sim,'negative-controls/result.json'));
 const parsed=parseFpgaReports({check_timing:fs.readFileSync(path.join(impl,'check-timing.rpt'),'utf8'),route:fs.readFileSync(path.join(impl,'route-status.rpt'),'utf8'),utilization:fs.readFileSync(path.join(impl,'utilization.rpt'),'utf8')});
 const assessment=assessFpga(physical,parsed);
 const drcZero=/Violations found:\s*0\b/.test(fs.readFileSync(path.join(impl,'drc.rpt'),'utf8'));
 const unchanged=Object.entries(input_hashes).every(([f,sha])=>digest(path.join(root,f))===sha);
 Object.assign(result,{oracle,negative,physical,assessment,parsed_reports:parsed,drc_zero:drcZero,inputs_unchanged:unchanged});
 result.status=oracle.passed===true&&oracle.frames===16&&oracle.bins_checked===16384&&negative.rejected===4&&negative.total===4&&physical.black_boxes===0&&physical.part==='xc7a100tfgg676-2'&&physical.clock_period_ns===10&&drcZero&&unchanged&&['setup_hold','clock_and_internal_constraints','io_constraints','routing'].every(k=>assessment[k]==='pass')?'passed':'failed';
}catch(error){result.status='failed';result.error=error.message;}
result.finished_at=new Date().toISOString();
write(path.join(folder,'result.json'),result);
console.log(JSON.stringify({directory:relative(folder),status:result.status,error:result.error,runs:result.runs},null,2));
if(result.status!=='passed')process.exitCode=1;
