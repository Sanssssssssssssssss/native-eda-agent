import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tclWord, normalizeFpgaArgs, makeFpgaTcl, parseFpgaReports, assessFpga, assertVivadoConstraintExecution } from '../src/tools/fpga.mjs';
import { validateXsimOptions, xsimCommands, simulationAcceptance } from '../src/tools/xsim-options.mjs';
const root=path.resolve(import.meta.dirname,'..');

test('skipped upstream CDC constraints reject an otherwise completed Vivado run',()=>{
  const log="CRITICAL WARNING: [Designutils 20-1307] Command 'foreach' is not supported in the xdc constraint file. [physical-review.xdc:25]\nEDA_FPGA_TOOL_COMPLETE";
  assert.throws(()=>assertVivadoConstraintExecution(log),/skipped or rejected constraints/);
  assert.doesNotThrow(()=>assertVivadoConstraintExecution('WARNING: [Route 35-198] OOC port has no associated HD.PARTPIN_LOCS.'));
  const script=makeFpgaTcl('eda_vivado_implement',{checkpoint:'a.dcp',constraints:['clocks.xdc'],constraint_scripts:['upstream-cdc.tcl']},'helper.tcl');
  assert.ok(script.indexOf('source "upstream-cdc.tcl"')>script.indexOf('open_checkpoint'));
  assert.ok(script.indexOf('source "upstream-cdc.tcl"')<script.indexOf('opt_design'));
  assert.ok(!script.includes('read_xdc "upstream-cdc.tcl"'));
});

test('FPGA input validation rejects workspace escapes, unsupported source types, hidden fields and excessive query sizes',()=>{
  assert.throws(()=>normalizeFpgaArgs(root,'eda_vivado_reports',{checkpoint:'../SynopsysAgent/README.md',reports:['timing']}),/inside/);
  assert.throws(()=>normalizeFpgaArgs(root,'eda_vivado_synthesize',{top:'top',part:'xc7a100tfgg676-2',sources:['package.json']}),/Sources/);
  assert.throws(()=>normalizeFpgaArgs(root,'eda_vivado_catalog',{kind:'parts',limit:1000000}),/integer/);
  assert.throws(()=>normalizeFpgaArgs(root,'eda_vivado_catalog',{kind:'parts',script:'exec malicious'}),/unexpected/);
  assert.throws(()=>normalizeFpgaArgs(root,'eda_vivado_catalog',{kind:'ips',pattern:'a\nexec bad'}),/string/);
});

test('Tcl generation keeps query metacharacters inside one quoted data word',()=>{
  const probe='name"; [error injected]; $env(HOME) \\ \n';
  const quoted=tclWord(probe);
  assert.ok(quoted.includes('\\[error injected\\]'));
  assert.ok(quoted.includes('\\$env(HOME)'));
  assert.ok(quoted.includes('\\";'));
  assert.equal(quoted.includes('\n'),false);
  const script=makeFpgaTcl('eda_vivado_catalog',{kind:'ips',pattern:probe},'C:/helper with spaces.tcl');
  assert.equal(script.split('\n').filter(x=>x.startsWith('eda::catalog')).length,1);
  assert.ok(!script.includes('\nerror injected'));
});

test('real retained Ethernet reports preserve CDC warnings, unconstrained reset and physical LUT counts',()=>{
  const dir=path.join(root,'tests/fixtures/fpga-ethernet');
  const parsed=parseFpgaReports(Object.fromEntries([['check_timing','check-timing.rpt'],['route','route-status.rpt'],['utilization','utilization.rpt'],['cdc','cdc.rpt']].map(([key,file])=>[key,fs.readFileSync(path.join(dir,file),'utf8')])));
  assert.equal(parsed.utilization['Slice LUTs'],1896);
  assert.equal(parsed.route.status,'pass');
  assert.equal(parsed.cdc_rules.reduce((n,x)=>n+(x.severity==='Warning'?x.count:0),0),34);
  const assessment=assessFpga({setup_slack_ns:2.51,hold_slack_ns:0.073},parsed);
  assert.equal(assessment.setup_hold,'pass');
  assert.equal(assessment.clock_and_internal_constraints,'pass');
  assert.equal(assessment.io_constraints,'review_required');
  assert.equal(assessment.cdc,'review_required');
  assert.equal(assessment.overall_design_acceptance,'not_evaluated');
});

test('only named asynchronous reset exceptions with verified release chains satisfy IO coverage',()=>{
  const base=fs.readFileSync(path.join(root,'tests/fixtures/fpga-ethernet/check-timing.rpt'),'utf8');
  const text=base.replace('There is 1 input port with no input delay specified. (HIGH)','There are 0 input ports with no input delay specified.')
    .replace(/\r?\nreset\r?\n/,'\n')
    .replace('There are 0 input ports with no input delay but user has a false path constraint.','There is 1 input port with no input delay but user has a false path constraint. (MEDIUM)\n\nreset\n');
  const parsed=parseFpgaReports({check_timing:text});
  const raw={async_reset_audit:{status:'verified',ports:[{name:'reset',leaf_loads:9,release_chains:[{clock:'logic_clk',stages:3},{clock:'rx_clk',stages:3},{clock:'tx_clk',stages:3}]}]}};
  assert.equal(assessFpga({},parsed).io_constraints,'review_required');
  assert.equal(assessFpga(raw,parsed).io_constraints,'pass');
  assert.deepEqual(assessFpga(raw,parsed).verified_async_reset_exceptions,['reset']);
  assert.equal(parsed.timing_checks.no_input_delay,1); // Raw warning is preserved.
  for(const change of [r=>r.async_reset_audit.ports[0].name='data',r=>r.async_reset_audit.ports[0].release_chains[0].stages=1,r=>r.async_reset_audit.status='unknown']){
    const changed=structuredClone(raw);change(changed);
    assert.equal(assessFpga(changed,parsed).io_constraints,'review_required');
  }
  assert.equal(assessFpga(raw,{...parsed,input_delays:{...parsed.input_delays,missing:1}}).io_constraints,'review_required');
  assert.equal(assessFpga(raw,{...parsed,input_delays:{...parsed.input_delays,false_path_ports:['reset','data']}}).io_constraints,'review_required');
});

test('missing, malformed and negative report evidence cannot become a clean design result',()=>{
  const empty=parseFpgaReports({});
  assert.equal(assessFpga({},empty).setup_hold,'unknown');
  assert.equal(assessFpga({setup_slack_ns:-0.001,hold_slack_ns:0.1},empty).setup_hold,'fail');
  assert.equal(empty.route.status,'unknown');
  assert.equal(parseFpgaReports({utilization:'| Slice LUTs* | 2048 | 0 | 63400 | 3.2 |'}).utilization['Slice LUTs'],2048);
  assert.equal(assessFpga({},empty).cdc,'unknown');
  const failedRoute=parseFpgaReports({route:'# of routable nets.... : 100 :\n# of fully routed nets.... : 99 :\n# of nets with routing errors.... : 1 :'});
  assert.equal(failedRoute.route.status,'fail');
  assert.throws(()=>parseFpgaReports({check_timing:'checking no_clock (0)\nchecking no_clock (1)'}),/Inconsistent/);
});

test('mixed-language simulation options preserve ordered VHDL, include paths, parameters and plusargs',()=>{
  const args={sources:['projects/fpga-tool-validation/xor_vhdl.vhd','projects/fpga-tool-validation/tb_options.sv'],top:'tb_fpga_options',include_dirs:['projects/fpga-tool-validation/include files'],defines:['BUILD_VALUE=37'],generics:['CYCLES=23'],plusargs:['SEED=17'],sv_seed:42};
  const command=xsimCommands(root,args);
  assert.equal(command.compile[0].exe,'xvhdl.bat');
  assert.ok(command.compile[1].args.includes(path.resolve(root,args.include_dirs[0])));
  assert.deepEqual(command.elaborate.slice(-2),['--generic_top','CYCLES=23']);
  assert.ok(command.simulate.includes('SEED=17'));
  assert.throws(()=>validateXsimOptions(root,{...args,timeout_seconds:0}),/timeout/);
  assert.throws(()=>validateXsimOptions(root,{...args,libraries:['unisim=../external']}),/library/);
  assert.throws(()=>validateXsimOptions(root,{...args,include_dirs:[os.tmpdir()]}),/outside/);
});

test('XSim PASS requires one explicit marker and completion; diagnostics take precedence',()=>{
  const good='DESIGN_PASS checks=25\n$finish called at time : 100 ns';
  assert.equal(simulationAcceptance(good,'DESIGN_PASS').status,'pass');
  assert.equal(simulationAcceptance(good+'\nFatal: bad','DESIGN_PASS').status,'fail');
  assert.equal(simulationAcceptance(good+'\nError: runtime assertion','DESIGN_PASS').status,'fail');
  assert.equal(simulationAcceptance('DESIGN_PASS','DESIGN_PASS').status,'incomplete');
  assert.equal(simulationAcceptance(good+'\nDESIGN_PASS','DESIGN_PASS').status,'incomplete');
  assert.equal(simulationAcceptance(good).status,'not_evaluated');
  assert.equal(simulationAcceptance('OPTIONS_TIMEOUT','DESIGN_PASS').status,'fail');
});
