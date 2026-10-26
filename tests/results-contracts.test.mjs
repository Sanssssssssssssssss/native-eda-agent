import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadResults,getResult,verifyResult,compareResults,resultPath} from '../src/results.mjs';
import {validateArguments,specializeSchema} from '../src/tool-contracts.mjs';
import {fpgaSurfaces} from '../src/tools/focused.mjs';
import {createFpgaTools} from '../src/tools/fpga.mjs';
import {createOptimizerTools} from '../src/tools/optimizer.mjs';
import {doctor} from '../src/platform.mjs';
const root=path.resolve(import.meta.dirname,'..');
test('doctor reports the installed ESM-only Pi package version without starting a provider',()=>{
  const pinned=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).dependencies['@earendil-works/pi-coding-agent'];
  assert.equal(doctor(root).pi,pinned);
});
test('historical protocols and denominators remain distinct, with every packaged hash verified',()=>{
  const catalog=loadResults(root);
  assert.equal(catalog.records.length,11);
  for(const r of catalog.records){const check=verifyResult(root,r.id);assert.equal(check.public_evidence_valid,true,r.id);assert.equal(check.available_originals_valid,true,r.id);}
  assert.equal(getResult(root,'verilogeval-24-original').passed,20);
  assert.equal(getResult(root,'verilogeval-24-extended').passed,23);
  assert.equal(getResult(root,'optimizer-axi-smoke').wns_gain_ns,0);
  assert.deepEqual(compareResults(root,'verilogeval-24-original','verilogeval-24-extended').mismatches,['protocol']);
  assert.equal(compareResults(root,'hard-projects-3','system-projects-4').comparable,false);
});
test('tampering and missing originals cannot become verified reproduction',t=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'eda-score-'));
  t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
  fs.cpSync(path.join(root,'results'),path.join(temporary,'results'),{recursive:true});
  const id='verilogeval-24-original';
  let checked=verifyResult(temporary,id);
  assert.equal(checked.public_evidence_valid,true);assert.equal(checked.originals_available,0);
  fs.appendFileSync(path.join(temporary,getResult(temporary,id).evidence[0].path),'tamper');
  checked=verifyResult(temporary,id);assert.equal(checked.public_evidence_valid,false);
  assert.equal(compareResults(temporary,id,id).comparable,false);
  assert.throws(()=>resultPath(temporary,'../secret.json'),/relative/);
  assert.throws(()=>resultPath(temporary,'C:/secret.json'),/relative/);
});
test('focused FPGA dispatch preserves selector and resource contract without starting EDA',()=>{
  const tools=createFpgaTools(root,(name,operation,options)=>({name,operation,options}));
  for(const surface of fpgaSurfaces){
    const tool=tools.find(t=>t.name===surface.name);
    assert.equal(tool.execute.options.resource,'vivado');
    for(const field of Object.keys(surface.fixed))assert.ok(!Object.hasOwn(tool.parameters.properties,field));
    assert.throws(()=>validateArguments({...Object.fromEntries(surface.required.map(k=>[k,'input.dcp'])),...surface.fixed},tool.parameters),/unexpected/);
  }
});
test('CLI contract rejects nonfinite numbers and hidden control fields',()=>{
  const s={type:'object',properties:{n:{type:'integer',minimum:1,maximum:3}},required:['n'],additionalProperties:false};
  for(const n of [NaN,Infinity,0,4,1.5])assert.throws(()=>validateArguments({n},s));
  assert.throws(()=>validateArguments({n:1,action:'run'},s),/unexpected/);
  assert.throws(()=>specializeSchema(s,['missing']),/Unknown/);
  validateArguments({n:1},s);
});

test('optimizer schema enforces required alternatives and sibling limits before dispatch',()=>{
  const schema=createOptimizerTools(root,()=>{})[0].parameters;
  for(const args of [{},null,[],{checkpoint:''},{checkpoint:'input.dcp',mode:'invalid'},
    {checkpoint:'input.dcp',max_trials:8},{checkpoint:'input.dcp',max_seconds:59},
    {checkpoint:'input.dcp',min_gain_ns:NaN},{resume_from:'run',hidden:true}]) {
    assert.throws(()=>validateArguments(args,schema));
  }
  for(const args of [{checkpoint:'input.dcp',max_trials:7,mode:'plan'},{resume_from:'run',mode:'run'}]) {
    const original=structuredClone(args);validateArguments(args,schema);assert.deepEqual(args,original);
  }
});
