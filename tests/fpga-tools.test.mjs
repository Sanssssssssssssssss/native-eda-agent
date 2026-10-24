import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tclWord, normalizeFpgaArgs, makeFpgaTcl, parseFpgaReports, assessFpga } from '../src/tools/fpga.mjs';
import { validateXsimOptions, xsimCommands, simulationAcceptance } from '../src/tools/xsim-options.mjs';
const root=path.resolve(import.meta.dirname,'..');

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
