// Local retrieval and operating procedures. No embeddings, provider or network.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readKnowledge, validateKnowledge} from '../scripts/check-knowledge.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const knowledgeBaseFiles = ['src/knowledge.mjs','scripts/check-knowledge.mjs','knowledge/rules.json','knowledge/sources.json','knowledge/sops.json','knowledge/tools.json'];
const boundary = 'Retrieval supplies cited guidance. A matching rule or SOP does not prove RTL, timing, CDC, formal or board correctness. Scores are lexical relevance, not confidence.';

function bundleAt(root) {
  const bundle = readKnowledge(root);
  const validation = validateKnowledge(bundle, {root});
  if (!validation.valid) throw new Error(`Invalid knowledge bundle: ${validation.errors.join('; ')}`);
  return {...bundle, validation};
}
function fileAt(root, name) {
  const base = fs.realpathSync(root), file = fs.realpathSync(path.resolve(root, name));
  const rel = path.relative(base, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !fs.statSync(file).isFile()) throw new Error('Knowledge file must stay in workspace');
  return file;
}
export function knowledgeFiles(root, sopIds = null) {
  const catalog = JSON.parse(fs.readFileSync(path.join(root,'knowledge/sops.json'),'utf8')).sops;
  const paths = [...knowledgeBaseFiles];
  for (const id of sopIds ?? catalog.map(s=>s.id)) {
    const item = catalog.find(s => s.id === id);
    if (!item) throw new Error(`Unknown SOP: ${id}`);
    paths.push(item.skill_path);
  }
  return [...new Set(paths)].map(name => fileAt(root, name));
}
function hashes(root, files) {
  return Object.fromEntries(files.map(file => [path.relative(root,file).replaceAll('\\','/'),sha(fs.readFileSync(file))]));
}
export function tokenize(text) {
  const normalized = text.normalize('NFKC').toLowerCase();
  const tokens = normalized.match(/[a-z0-9_]+/g) || [];
  for (const run of normalized.match(/\p{Script=Han}+/gu) || []) {
    const chars = [...run];
    if (chars.length === 1) tokens.push(chars[0]);
    else for (let i=0;i<chars.length-1;i++) tokens.push(chars[i]+chars[i+1]);
  }
  return tokens;
}
function termsFor(rule) {
  // Prefer names/tags to long provenance text; URLs and local paths are not indexed.
  const title = [rule.title, ...rule.tags].join(' ');
  return tokenize(`${title} ${title} ${title} ${rule.statement} ${rule.scope} ${rule.evidence_required.join(' ')} ${rule.static_proof_boundary}`);
}
export function queryKnowledge(root, {query='',id,limit=8,classification,source_id}={}) {
  if (!Number.isInteger(limit) || limit<1 || limit>40 || typeof query!=='string' || query.length>2048) throw new Error('Invalid knowledge query or limit');
  if (classification && !['rule','recommendation','limitation'].includes(classification)) throw new Error('Invalid rule classification');
  const bundle=bundleAt(root), rules=bundle.rules.rules, sources=bundle.sources.sources;
  if (id && !rules.some(r=>r.id===id)) throw new Error(`Unknown knowledge ID: ${id}`);
  if (source_id && !sources.some(s=>s.id===source_id)) throw new Error(`Unknown source ID: ${source_id}`);
  const terms=[...new Set(tokenize(query))], docs=rules.map(termsFor);
  const average=docs.reduce((sum,d)=>sum+d.length,0)/docs.length;
  const frequency=new Map(terms.map(term=>[term,docs.filter(d=>d.includes(term)).length]));
  const scored=rules.map((rule,i)=>{
    let score=0;const matched=[];
    for (const term of terms) {
      const tf=docs[i].filter(t=>t===term).length;
      if (!tf) continue;
      matched.push(term);
      const df=frequency.get(term),idf=Math.log(1+(rules.length-df+0.5)/(df+0.5));
      score+=idf*(tf*2.2)/(tf+1.2*(0.25+0.75*docs[i].length/average));
    }
    return {rule,score,matched};
  }).filter(({rule,score})=>(id?rule.id===id:!query.trim()||score>0) && (!classification||rule.classification===classification) && (!source_id||rule.source_refs.some(r=>r.source_id===source_id)))
    .sort((a,b)=>b.score-a.score||a.rule.id.localeCompare(b.rule.id));
  const selected=scored.slice(0,limit);
  return {schema_version:1,total:scored.length,rules:selected.map(({rule})=>rule),
    sources:sources.filter(s=>selected.some(({rule})=>rule.source_refs.some(ref=>ref.source_id===s.id))),
    retrieval:{method:id?'exact-id':'local-bm25-en-han-bigram-v1',query,terms,ranking:selected.map(({rule,score,matched})=>({id:rule.id,score:Number(score.toFixed(6)),matched_terms:matched})),
      corpus_hashes:hashes(root,knowledgeFiles(root)),external_model_api_calls:0},
    optional_local_references:bundle.validation.optional_unavailable,boundary};
}
export function querySop(root, {id}={}) {
  const bundle=bundleAt(root), catalog=bundle.sops.sops;
  if (!id) return {schema_version:1,sops:catalog,boundary};
  const sop=catalog.find(s=>s.id===id);
  if (!sop) throw new Error(`Unknown SOP: ${id}`);
  const content=fs.readFileSync(fileAt(root,sop.skill_path),'utf8');
  const rules=bundle.rules.rules.filter(r=>sop.rule_ids.includes(r.id));
  return {schema_version:1,sop,content,rules,sources:bundle.sources.sources.filter(s=>rules.some(r=>r.source_refs.some(ref=>ref.source_id===s.id))),
    input_hashes:hashes(root,knowledgeFiles(root,[id])),enforcement:'Advisory procedure; only explicit executor/workflow checks are enforced.',boundary};
}
export function resolveGuidance(root, {rule_ids=[],sop_ids=[]}={}) {
  const bundle=bundleAt(root), ids=new Set(rule_ids),sops=[];
  for (const id of sop_ids) {
    const sop=bundle.sops.sops.find(s=>s.id===id);
    if (!sop) throw new Error(`Unknown SOP: ${id}`);
    sops.push(sop);sop.rule_ids.forEach(id=>ids.add(id));
  }
  for (const id of ids) if (!bundle.rules.rules.some(r=>r.id===id)) throw new Error(`Unknown knowledge ID: ${id}`);
  const rules=bundle.rules.rules.filter(r=>ids.has(r.id));
  return {rule_ids:[...ids].sort(),sop_ids:[...sop_ids],sops,
    rules:rules.map(({id,classification,scope,versions,evidence_required,source_refs,static_proof_boundary})=>({id,classification,scope,versions,evidence_required,source_refs,static_proof_boundary})),
    sources:bundle.sources.sources.filter(s=>rules.some(r=>r.source_refs.some(ref=>ref.source_id===s.id))),
    input_hashes:hashes(root,knowledgeFiles(root,sop_ids)),boundary,
    enforcement:'Selection and content hashes are frozen. Declared step checks enforce acceptance; selecting an SOP does not prove compliance with every procedure.'};
}
