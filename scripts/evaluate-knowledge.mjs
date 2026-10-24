import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {queryKnowledge} from '../src/knowledge.mjs';
const root=path.resolve(import.meta.dirname,'..');
export function evaluateRetrieval(workspace=root) {
  const file=path.join(workspace,'knowledge/retrieval-cases.json'),bytes=fs.readFileSync(file);
  const suite=JSON.parse(bytes),rules=JSON.parse(fs.readFileSync(path.join(workspace,'knowledge/rules.json'),'utf8')).rules;
  const cases=suite.cases.map(item=>{
    const terms=item.query.toLowerCase().split(/\s+/).filter(Boolean);
    const before=rules.filter(r=>terms.every(term=>JSON.stringify(r).toLowerCase().includes(term))).slice(0,suite.top_k).map(r=>r.id);
    const after=queryKnowledge(workspace,{query:item.query,limit:suite.top_k}).rules.map(r=>r.id);
    return {...item,before,after};
  });
  const summarize=key=>{
    const ranks=cases.map(c=>c[key].findIndex(id=>c.relevant.includes(id))+1);
    return {hits:ranks.filter(Boolean).length,total:cases.length,hit_at_k:ranks.filter(Boolean).length/cases.length,
      mrr_at_k:ranks.reduce((sum,r)=>sum+(r?1/r:0),0)/cases.length};
  };
  const unrelated=suite.unrelated_queries.map(query=>({query,returned:queryKnowledge(workspace,{query}).total}));
  return {schema_version:1,scope:suite.scope,top_k:suite.top_k,case_set_sha256:createHash('sha256').update(bytes).digest('hex'),
    corpus_hashes:queryKnowledge(workspace,{id:rules[0].id}).retrieval.corpus_hashes,
    baseline_method:'Previous whitespace-AND substring search over serialized rules',current_method:'local-bm25-en-han-bigram-v1',
    before:summarize('before'),after:summarize('after'),unrelated,cases,model_api_calls:0,eda_runs:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const result=evaluateRetrieval(),dir=path.join(root,'artifacts',`knowledge-eval-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,6)}`);
  fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({evidence:dir,scope:result.scope,before:result.before,after:result.after,unrelated:result.unrelated},null,2));
  if(result.after.hits<result.before.hits||result.unrelated.some(q=>q.returned))process.exitCode=1;
}
