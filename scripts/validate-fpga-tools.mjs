// End-to-end MCP validation with real local Vivado/XSim; no model client.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
const root=path.resolve(import.meta.dirname,'..');
const dir=path.join(root,'artifacts',`fpga-tools-validation-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,6)}`);
fs.mkdirSync(dir,{recursive:true});
const client=new Client({name:'fpga-real-validation',version:'1.0.0'});
const parallel=process.argv.includes('--parallel');
const receipt={started_at:new Date().toISOString(),model_api_calls:0,checks:[],directory:dir,scheduling:parallel?'parallel-xsim-vivado':'serial-xsim-then-vivado',scope:'Adapter integration tests on existing projects; not new independent design benchmark problems.'};
const persist=()=>fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(receipt,null,2)+'\n');
const controller=new AbortController();process.on('SIGINT',()=>controller.abort());
async function check(label,tool,args,validate) {
  const start=Date.now();let response;
  try {
    response=await client.callTool({name:tool,arguments:args},{timeout:1200000,signal:controller.signal});
    assert.equal(Boolean(response.isError),false,JSON.stringify(response));
    const data=response.structuredContent;
    validate(data);
    const row={label,tool,passed:true,directory:data.directory,duration_ms:Date.now()-start,arguments:args};
    receipt.checks.push(row);persist();console.log(`PASS ${label} ${data.directory}`);return data;
  } catch(error) {
    receipt.checks.push({label,tool,passed:false,error:String(error),response,duration_ms:Date.now()-start,arguments:args});persist();throw error;
  }
}
function previousCheckpoint(project) {
  const previous=JSON.parse(fs.readFileSync(path.join(root,`projects/hard-bench/${project}/latest-impl.json`),'utf8'));
  const dcps=fs.readdirSync(previous.artifact_directory).filter(f=>f.endsWith('.dcp'));
  assert.equal(dcps.length,1);return path.relative(root,path.join(previous.artifact_directory,dcps[0]));
}
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'src/mcp-server.mjs')],cwd:root,stderr:'inherit'}));
  const listing=await client.listTools(),names=new Set(listing.tools.map(tool=>tool.name));
  for(const name of ['eda_xsim','eda_vivado_catalog','eda_vivado_synthesize','eda_vivado_implement','eda_vivado_reports','eda_vivado_timing_paths','eda_vivado_objects'])assert.ok(names.has(name),`Required integration tool missing: ${name}`);
  receipt.tool_count=listing.tools.length;persist();
  // This historical adapter suite needs the retained routed designs. Check
  // them before spending time on simulation/synthesis in a fresh checkout.
  const ethernet=previousCheckpoint('ethernet-cdc'),crypto=previousCheckpoint('crypto-soc');
  const options={sources:['projects/fpga-tool-validation/xor_vhdl.vhd','projects/fpga-tool-validation/tb_options.sv'],top:'tb_fpga_options',include_dirs:['projects/fpga-tool-validation/include files'],defines:['BUILD_VALUE=37'],generics:['CYCLES=23'],plusargs:['SEED=17'],sv_seed:123,libraries:['unisims_ver'],pass_marker:'FPGA_OPTIONS_PASS',timeout_seconds:60};
  const xsim=async()=>{
    await check('xsim-options-mixed-language','eda_xsim',options,d=>assert.equal(d.simulation_acceptance.status,'pass'));
    await check('xsim-fatal-negative','eda_xsim',{...options,plusargs:['SEED=17','INJECT=1']},d=>{assert.equal(d.simulation_acceptance.status,'fail');assert.match(d.transcript_tail,/OPTIONS_EXPECTED_NEGATIVE/);});
    const axi=JSON.parse(fs.readFileSync(path.join(root,'projects/hard-bench/axi-fabric/sim.json'),'utf8'));
    await check('axi-functional-regression','eda_xsim',{...axi,pass_marker:'HARD_BENCH_PASS'},d=>{
      assert.equal(d.simulation_acceptance.status,'pass');
      assert.match(d.transcript_tail,/HARD_BENCH_PASS project=axi_fabric seeds=4 write_bursts=2328 read_bursts=2328/);
      assert.match(d.transcript_tail,/bytes_read_checked=100992\b/);
    });
  };
  const vivado=async()=>{
    await check('catalog-commands','eda_vivado_catalog',{kind:'commands',pattern:'report_*',limit:5},d=>{assert.equal(d.fpga.items.length,5);assert.ok(d.fpga.total>5);});
    await check('catalog-query-is-data','eda_vivado_catalog',{kind:'commands',pattern:'"; error EDA_QUERY_WAS_EXECUTED; # $anything [exit]',limit:5},d=>assert.equal(d.fpga.total,0));
    await check('catalog-part','eda_vivado_catalog',{kind:'parts',pattern:'xc7a100tfgg676-2',limit:5},d=>assert.deepEqual(d.fpga.items,['xc7a100tfgg676-2']));
    await check('catalog-ip','eda_vivado_catalog',{kind:'ips',pattern:'xilinx.com:ip:axi_fifo_mm_s:*',limit:5},d=>assert.ok(d.fpga.items.some(v=>v.includes('axi_fifo_mm_s'))));
    const source=JSON.parse(fs.readFileSync(path.join(root,'projects/hard-bench/axi-fabric/sources.json'),'utf8'));
    const synthesized=await check('axi-synthesize','eda_vivado_synthesize',{...source,part:'xc7a100tfgg676-2',constraints:['projects/fpga-tool-validation/axi.xdc']},d=>{assert.equal(d.fpga.black_boxes,0);assert.ok(d.fpga.artifacts['synthesized.dcp']);assert.equal(d.fpga.clocks[0].period_ns,10);});
    const routed=await check('axi-implement','eda_vivado_implement',{checkpoint:path.relative(root,synthesized.fpga.artifacts['synthesized.dcp'])},d=>{assert.equal(d.fpga.assessment.setup_hold,'pass');assert.equal(d.fpga.assessment.routing,'pass');assert.equal(d.fpga.assessment.clock_and_internal_constraints,'pass');assert.ok(d.fpga.artifacts['routed.dcp']);});
    receipt.new_axi_route=routed.directory;persist();
    await check('ethernet-cdc-diagnostics','eda_vivado_reports',{checkpoint:ethernet,reports:['timing','utilization','cdc','drc','methodology','clocks','exceptions','route']},d=>{
      assert.equal(d.fpga.clocks.length,3);assert.equal(d.fpga.assessment.setup_hold,'pass');assert.equal(d.fpga.assessment.io_constraints,'review_required');assert.equal(d.fpga.assessment.cdc,'review_required');
      assert.equal(d.fpga.parsed_reports.cdc_rules.filter(x=>x.severity==='Warning').reduce((n,x)=>n+x.count,0),34);
    });
    await check('crypto-critical-paths','eda_vivado_timing_paths',{checkpoint:crypto,delay_type:'max',from_clock:'clk',to_clock:'clk',limit:5},d=>{assert.equal(d.fpga.paths.length,5);assert.ok(d.fpga.paths.every(p=>Number.isFinite(p.slack_ns)&&p.startpoint&&p.endpoint));assert.equal(d.fpga.whole_design_tns,null);});
    await check('crypto-block-ram-objects','eda_vivado_objects',{checkpoint:crypto,kind:'cells',pattern:'*ram*',limit:10},d=>{assert.equal(d.fpga.items.length,10);assert.ok(d.fpga.total>=10);});
  };
  if (parallel) {
    const results=await Promise.allSettled([xsim(),vivado()]);
    for(const result of results)if(result.status==='rejected')throw result.reason;
  } else { await xsim(); await vivado(); }
  receipt.passed=receipt.checks.every(c=>c.passed);
} catch(error){receipt.passed=false;receipt.error=String(error);process.exitCode=1;console.error(error);}
finally {await client.close();receipt.finished_at=new Date().toISOString();persist();console.log(JSON.stringify({passed:receipt.passed,checks:receipt.checks.length,directory:dir}));}
