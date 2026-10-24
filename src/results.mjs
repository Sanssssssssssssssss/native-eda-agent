import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function resultPath(root, name) {
  if (typeof name !== 'string' || path.isAbsolute(name) || /^[A-Za-z]:/.test(name) || name.split(/[\\/]/).includes('..')) throw new Error('Result evidence must be workspace-relative');
  const resolved=path.resolve(root,name);
  if (fs.existsSync(resolved)) {
    const relative=path.relative(fs.realpathSync(root),fs.realpathSync(resolved));
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Result evidence escapes workspace');
  }
  return resolved;
}
export function loadResults(root) {
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'results/catalog.json'),'utf8'));
  if (catalog.schema_version!==1 || !Array.isArray(catalog.records)) throw new Error('Unsupported results catalog');
  const ids=new Set();
  for (const r of catalog.records) {
    if (!r.id || ids.has(r.id) || !r.unit || !r.protocol || !r.scope || !Array.isArray(r.evidence) || !r.evidence.length) throw new Error('Invalid or duplicate score record');
    ids.add(r.id);
    if (r.passed!==undefined && (!Number.isInteger(r.passed) || !Number.isInteger(r.total) || r.total<=0 || r.passed<0 || r.passed>r.total)) throw new Error('Invalid score denominator');
  }
  return catalog;
}
export function getResult(root,id) {
  const record=loadResults(root).records.find(r=>r.id===id);
  if (!record) throw new Error(`Unknown result ID: ${id}`);
  return record;
}
export function verifyResult(root,id) {
  const record=getResult(root,id);
  const evidence=record.evidence.map(e=>{
    const check=(file,expected)=>{
      const target=resultPath(root,file);
      if (!fs.existsSync(target)) return 'unavailable';
      return sha256(fs.readFileSync(target))===expected?'match':'mismatch';
    };
    return {...e,public_integrity:check(e.path,e.sha256),original_integrity:check(e.original_path,e.original_sha256)};
  });
  return {id,public_evidence_valid:evidence.every(e=>e.public_integrity==='match'),
    available_originals_valid:!evidence.some(e=>e.original_integrity==='mismatch'),
    originals_available:evidence.filter(e=>e.original_integrity==='match').length,
    evidence,scope:'Hash verification of retained evidence only; no rerun, independent reproduction or design acceptance.'};
}
export function compareResults(root,baseline,candidate) {
  const a=getResult(root,baseline),b=getResult(root,candidate);
  const mismatches=['unit','task_set','protocol','scope'].filter(k=>a[k]!==b[k]);
  const integrity=[verifyResult(root,baseline),verifyResult(root,candidate)];
  if (integrity.some(r=>!r.public_evidence_valid||!r.available_originals_valid)) mismatches.push('evidence_integrity');
  const comparable=mismatches.length===0;
  return {baseline:a.id,candidate:b.id,comparable,mismatches,
    pass_delta:comparable && Number.isInteger(a.passed) && Number.isInteger(b.passed)?b.passed-a.passed:null,
    boundary:'Different test/watchdog protocols, project populations and evidence units cannot be combined into a single score.'};
}
const str={type:'string',minLength:1,maxLength:256};
const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
export function historyDefinitions(root) {
  return [
    {name:'eda_results_list',description:'List retained historical scorecards with original protocols and units. Does not run EDA.',parameters:schema({unit:str}),run:args=>({records:loadResults(root).records.filter(r=>!args.unit||r.unit===args.unit).map(({evidence,...r})=>({...r,evidence_count:evidence.length})),aggregate_score:null})},
    {name:'eda_results_get',description:'Read one historical scorecard, limitations and public/original evidence hashes.',parameters:schema({id:str},['id']),run:args=>getResult(root,args.id)},
    {name:'eda_results_verify',description:'Verify packaged evidence hashes and available local originals. Missing original artifacts are reported, never treated as reproduced.',parameters:schema({id:str},['id']),run:args=>verifyResult(root,args.id)},
    {name:'eda_results_compare',description:'Compare historical scores only if task population, protocol, scope, units and evidence integrity match.',parameters:schema({baseline:str,candidate:str},['baseline','candidate']),run:args=>compareResults(root,args.baseline,args.candidate)},
  ].map(d=>({...d,label:d.name}));
}
