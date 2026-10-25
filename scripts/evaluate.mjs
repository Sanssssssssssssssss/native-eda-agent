import {createJiti} from 'jiti';
import path from 'node:path';
import {evaluationSuites,evaluationPlan,runEvaluation} from '../src/evaluations.mjs';
const root=path.resolve(import.meta.dirname,'..'),[action='list',id,...flags]=process.argv.slice(2);
const abort=new AbortController();process.on('SIGINT',()=>abort.abort());
if(action==='list')console.log(JSON.stringify(evaluationSuites,null,2));
else if(action==='plan')console.log(JSON.stringify(evaluationPlan(root,id),null,2));
else if(action==='run'){
  const registry=new Map();(await createJiti(import.meta.url).import('../src/extension.ts',{default:true}))({registerTool:t=>registry.set(t.name,t)});
  const flag=name=>{const i=flags.indexOf(name);return i<0?undefined:flags[i+1];};
  const result=await runEvaluation(root,id,registry,{signal:abort.signal,session_directory:flag('--session'),workflow_directory:flag('--workflow')});
  console.log(JSON.stringify(result,null,2));if(result.status!=='passed')process.exitCode=1;
}else throw new Error('Usage: evaluate.mjs list | plan SUITE | run SUITE [--session DIR --workflow DIR]');
