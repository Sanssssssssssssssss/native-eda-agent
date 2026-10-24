import path from 'node:path';
import {loadResults,getResult,verifyResult,compareResults} from '../src/results.mjs';
const root=path.resolve(import.meta.dirname,'..');
const [action='list',a,b]=process.argv.slice(2);
try {
  const result=action==='list'?loadResults(root):action==='get'?getResult(root,a):action==='verify'?verifyResult(root,a):action==='compare'?compareResults(root,a,b):null;
  if (!result) throw new Error('Usage: results.mjs list|get ID|verify ID|compare BASE CANDIDATE');
  console.log(JSON.stringify(result,null,2));
  if(action==='verify'&&(!result.public_evidence_valid||!result.available_originals_valid))process.exitCode=1;
}catch(error){console.error(error.message);process.exitCode=1;}
