// Explicit archival import. Reads retained receipts; never executes EDA or changes scores.
import fs from 'node:fs';
import path from 'node:path';
import {sha256} from '../src/results.mjs';
const root=path.resolve(import.meta.dirname,'..');
const destination=path.join(root,'results/evidence'); fs.mkdirSync(destination,{recursive:true});
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const clean=value=>{
  if(Array.isArray(value))return value.map(clean);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['codex_usage','thread_id','session_id','chat_id','parent_thread_id'].includes(k)).map(([k,v])=>[k,clean(v)]));
  if(typeof value==='string')return value.replaceAll(root.replaceAll('\\','/'),'${WORKSPACE}').replaceAll(root,'${WORKSPACE}').replace(/[A-Z]:[\\/]Users[\\/][^\\/\s]+/gi,'${USER}');
  return value;
};
const packaged=new Map();
function evidence(file) {
  if(packaged.has(file))return packaged.get(file);
  const raw=fs.readFileSync(path.join(root,file));
  const id=sha256(Buffer.from(file)).slice(0,12)+'-'+path.basename(file);
  const text=file.endsWith('.json')?JSON.stringify(clean(JSON.parse(raw.toString('utf8'))),null,2)+'\n':clean(raw.toString('utf8'));
  const output=`results/evidence/${id}`;fs.writeFileSync(path.join(root,output),text);
  const e={path:output,sha256:sha256(Buffer.from(text)),original_path:file,original_sha256:sha256(raw),transformation:'Workspace/user paths normalized; session identifiers and usage details omitted when present. Public and original hashes are distinct.'};
  packaged.set(file,e);return e;
}
const records=[];
function add(id,title,unit,task_set,protocol,scope,metrics,sources,limitations) {
  records.push({id,title,recorded_on:'2026-10-23',kind:'historical',unit,task_set,protocol,scope,...metrics,
    limitations,other_model_api_calls:0,outer_codex_tokens:null,evidence:sources.map(evidence)});
}
const earlyFile='artifacts/codex-eda-assessment-20261023/score.json',early=read(earlyFile);
add('verilogeval-8-original','VerilogEval initial fixed eight','rtl_task','verilogeval-selected-eight','xsim-original-reference','functional_visible_tests',{passed:early.verilog_eval_subset.primary_passed,total:early.verilog_eval_subset.total},[earlyFile,'artifacts/verilogeval-codex-2026-10-22T16-17-42-454Z/result.json'],'Primary score remains 7/8; reference-aligned diagnostic repair is not a blind score.');
add('fft-1024','1024-point FFT spectrum pipeline','system_project','fft-1024-spectrum','vivado-2020.2-100mhz-ooc','visible_integration_and_ooc',{passed:1,total:1,frames:early.fft.frames_passed,bins:early.fft.bins_checked,setup_ns:early.fft.implementation.setup_slack_ns,hold_ns:early.fft.implementation.hold_slack_ns,negative_controls:early.fft.negative_controls_rejected},[earlyFile,'artifacts/2026-10-22T16-19-24-402Z-vivado-ee6aadf3/oracle-result.json'],'Vendor FFT IP with local wrapper and numerical oracle; OOC only, no hardware signoff.');
const veFile='artifacts/verilogeval-codex-2026-10-22T16-56-02-984Z/score.json', ve=read(veFile);
add('verilogeval-24-original','VerilogEval fixed 24: original watchdog','rtl_task','verilogeval-selected-24','xsim-original-watchdog-1000000ps','functional_visible_tests',{passed:ve.passed,total:ve.total},[veFile,'projects/verilogeval-24/selection.json'],'Purposive sample, not pass@1; corrected TIMEOUT verdict retained.');
add('verilogeval-24-extended','VerilogEval same RTL: extended watchdog','rtl_task','verilogeval-selected-24','xsim-extended-watchdog-10000000ps','functional_visible_tests',{passed:ve.extended_watchdog.passed,total:ve.total,rtl_changes:0,derived_from:'verilogeval-24-original'},[veFile,'artifacts/verilogeval-codex-2026-10-22T17-03-30-819Z/result.json'],'Same task set with three long-case reruns and changed watchdog; not 24 new tasks. One upstream-reference mismatch remains.');
const campaign='artifacts/benchmark-2026-10-22T18-44-46-676Z-55880096/summary.json', c=read(campaign);
add('campaign-61-frozen','Frozen mixed benchmark campaign','case_variant','campaign-61-48-families','catalog-'+c.catalog_sha256,'functional_and_negative_controls',{total:c.case_count,counts:c.counts??Object.fromEntries([...new Set(c.cases.map(x=>x.acceptance))].map(k=>[k,c.cases.filter(x=>x.acceptance===k).length])),families:c.family_count},[campaign],'Mixed variants and expected failures; queue timeouts remain. Never add this population to the selected VerilogEval tasks.');
const sysFile='artifacts/system-bench-assessment-20261023/results.json', sys=read(sysFile);
const systems=sys.projects.map(p=>({id:p.project,functional:p.simulation_verified,implementation:p.impl.pass,setup_ns:p.physical.setup_slack_ns,hold_ns:p.physical.hold_slack_ns,resources:p.physical_utilization}));
add('system-projects-4','SoC / DMA / UDP / AES integration','system_project','system-bench-four','vivado-2020.2-100mhz-ooc','visible_integration_and_ooc',{passed:systems.filter(p=>p.functional&&p.implementation).length,total:systems.length,projects:systems},[sysFile],'Pinned public IP integrated and debugged; no board, formal proof or blind generation score.');
const hardFile='artifacts/hard-bench-assessment-20261023/results.json', hard=read(hardFile);
const hardProjects=hard.projects.map(p=>({id:p.project,functional:p.functional_verified,negative_control:p.negative_control_verified,implementation:p.implementation_verified,setup_ns:p.implementation.build.setup_slack_ns,hold_ns:p.implementation.build.hold_slack_ns,resources:p.physical_resources,cdc:p.cdc_summary}));
add('hard-projects-3','AXI 3x3 / three-clock Ethernet / RV32IM AES DMA','system_project','hard-bench-three','vivado-2020.2-fixed-xdc-ooc','visible_integration_and_ooc',{passed:hard.totals.functional_pass,total:hard.totals.projects,negative_controls:hard.totals.negative_control_pass,implementation_pass:hard.totals.implementation_pass,projects:hardProjects},[hardFile],'Ethernet retains 34 CDC warnings; no formal CDC, MTBF or board signoff. Seeds and transactions are coverage, not independent projects.');
const optFile='artifacts/2026-10-24T08-54-15-928Z-eda_vivado_optimize-babf5915/optimizer/optimizer-result.json', opt=read(optFile);
add('optimizer-axi-smoke','AXI physical optimizer: two candidates','optimization_run','axi-fabric-native-tools-dcp','fixed-input-route-explore-aggressive-2-trials','physical_optimization',{trials:opt.attempts.length,accepted_candidates:opt.accepted_attempts,wns_gain_ns:opt.wns_gain_ns,winner_recheck:opt.winner_recheck,input_unchanged:opt.input_unchanged},[optFile],'Zero measured gain. Historical run predates new recovery/trace implementation; not FPL leaderboard reproduction.');
records.at(-1).recorded_on='2026-10-24';
const wbFile='artifacts/vivado-workbench-validation-20261024T082414Z/result.json',wb=read(wbFile);
add('workbench-integration-33','Project / IP / Block Design tool integration','tool_check','workbench-13-operations','vivado-2020.2-workbench','tool_integration',{passed:wb.checks.filter(x=>x.passed??x.pass??x.ok).length,total:wb.checks.length},[wbFile],'Tool checks, not additional FPGA designs.'); records.at(-1).recorded_on='2026-10-24';
const nativeFile='artifacts/fpga-tools-validation-2026-10-24T07-39-55-676Z-e8a611/scorecard.json',native=read(nativeFile);
add('native-integration-12','Native FPGA tools integration','tool_check','native-fpga-six-operations','vivado-2020.2-fixed-inputs','tool_integration',{passed:native.integration.passed,total:native.integration.total,axi:native.axi},[nativeFile],'Existing designs exercised through new adapters; not 12 new design tasks.'); records.at(-1).recorded_on='2026-10-24';
const offlineFile='artifacts/agent-offline-2026-10-24T10-37-24-616Z-be93aa/result.json',off=read(offlineFile);
add('agent-offline-20261024','Agent framework offline acceptance','software_test','agent-offline-20261024','source-hashes-in-receipt','synthetic_control_plane',{passed:off.checks.filter(x=>x.passed).reduce((n,x)=>n+(x.test_count||0),0),total:off.checks.reduce((n,x)=>n+(x.test_count||0),0)},[offlineFile],'Fake EDA, local subprocesses and MCP control plane only; no new FPGA run.');records.at(-1).recorded_on='2026-10-24';
fs.writeFileSync(path.join(root,'results/catalog.json'),JSON.stringify({schema_version:1,imported_at:new Date().toISOString(),aggregate_score:null,policy:'Preserve frozen protocols, failed outcomes and separate evidence units. Import does not rerun designs.',records},null,2)+'\n');
console.log(JSON.stringify({records:records.length,evidence_files:packaged.size,eda_runs:0}));
