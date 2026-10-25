import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {checkRepository,REQUIRED_FILES} from '../scripts/check-repository.mjs';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'eda-repository-'));
  t.after(()=>{
    const relative=path.relative(os.tmpdir(),fs.realpathSync(root));
    assert.ok(relative.startsWith('eda-repository-')&&!relative.includes(path.sep));
    fs.rmSync(root,{recursive:true,force:true});
  });
  function write(file,content='fixture\n'){
    fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});
    fs.writeFileSync(path.join(root,file),content);
  }
  for(const file of REQUIRED_FILES)write(file);
  write('.eda/config.json',JSON.stringify({model_api_enabled:false}));
  write('release/upstreams.json',JSON.stringify({sources:[{name:'ace-rtl',commit:'94754d796350d42502c9a32639a20d86f50e9678',bundled:true}]}));
  function manifest(extra=[]){write('release/source-manifest.json',JSON.stringify({files:Object.fromEntries([...REQUIRED_FILES,...extra].map(file=>[file,'fixture-hash']))}));}
  function git(...args){const result=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);return result.stdout;}
  manifest();
  return {root,write,manifest,git};
}

test('Git publication rejects nested repositories and private files while ignored local state is allowed',t=>{
  const f=fixture(t);
  f.write('.gitignore','artifacts/\n.pi/mcp.json\n');
  f.write('tests/fixtures/simulator.log','Fixed simulator fixture\n');
  f.write('release/archived-evidence/runner.log','Sanitized historical evidence\n');
  f.git('init','--quiet');f.git('add','.');
  f.write('artifacts/local-run.json','LOCAL_CONTENT_MUST_NOT_APPEAR');
  f.write('.pi/mcp.json','MACHINE_CONFIGURATION_MUST_NOT_APPEAR');
  f.git('check-ignore','artifacts/local-run.json','.pi/mcp.json');
  assert.equal(checkRepository(f.root).passed,true);
  f.git('add','--force','artifacts/local-run.json','.pi/mcp.json');
  f.git('update-index','--add','--cacheinfo',`160000,${'a'.repeat(40)},vendor/nested-checkout`);
  const report=checkRepository(f.root);
  assert.equal(report.scope,'git-index');assert.equal(report.tracked_check,true);
  assert.ok(report.issues.some(issue=>issue.code==='gitlink'));
  assert.ok(report.issues.some(issue=>issue.code==='private_file'&&issue.file==='artifacts/local-run.json'));
  assert.ok(report.issues.some(issue=>issue.code==='private_file'&&issue.file==='.pi/mcp.json'));
  assert.ok(!JSON.stringify(report).includes('LOCAL_CONTENT_MUST_NOT_APPEAR'));
  assert.ok(!JSON.stringify(report).includes('MACHINE_CONFIGURATION_MUST_NOT_APPEAR'));
});

test('Export requires the actual verifier, ACE source, reviewed pin, and disabled model gate',t=>{
  const f=fixture(t);
  assert.equal(checkRepository(f.root).passed,true);
  f.write('.PI/MCP.JSON','PRIVATE_CONFIGURATION\n');f.manifest(['.PI/MCP.JSON']);
  assert.ok(checkRepository(f.root).issues.some(issue=>issue.code==='private_file'&&issue.file==='.PI/MCP.JSON'));
  fs.unlinkSync(path.join(f.root,'src/verifier-loop.mjs'));
  fs.unlinkSync(path.join(f.root,'vendor/ace-rtl/skills/ace-rtl/scripts/ace_rtl_agent/context_builder.py'));
  f.write('release/upstreams.json',JSON.stringify({sources:[]}));
  f.write('.eda/config.json',JSON.stringify({model_api_enabled:true}));
  const report=checkRepository(f.root);
  assert.equal(report.scope,'export-manifest');
  assert.ok(report.issues.some(issue=>issue.code==='required_file_missing'&&issue.file==='src/verifier-loop.mjs'));
  assert.ok(report.issues.some(issue=>issue.code==='required_file_missing'&&issue.file.endsWith('context_builder.py')));
  assert.ok(report.issues.some(issue=>issue.code==='ace_pin'));
  assert.ok(report.issues.some(issue=>issue.code==='model_api_gate'));
});

test('Relative links must ship with an export; local evidence remains usable in a source-only workspace',t=>{
  const f=fixture(t);
  f.write('artifacts/run/result.json','{}');
  f.write('README.md','[Local evidence](artifacts/run/result.json)\n[Guide](docs/README.md#usage)\n[Remote](https://example.invalid/)\n');
  let report=checkRepository(f.root);
  assert.ok(report.issues.some(issue=>issue.code==='broken_link'&&issue.file==='README.md'));
  fs.unlinkSync(path.join(f.root,'release/source-manifest.json'));
  report=checkRepository(f.root);
  assert.equal(report.scope,'source-only');assert.equal(report.tracked_check,false);assert.equal(report.passed,true);
  f.write('README.md','[Missing](docs/missing.md)\n');
  assert.ok(checkRepository(f.root).issues.some(issue=>issue.code==='broken_link'));
});
