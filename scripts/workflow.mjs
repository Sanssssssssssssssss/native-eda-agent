import fs from 'node:fs';
import path from 'node:path';
import {createJiti} from 'jiti';
import {workflowSchema} from '../src/workflow.mjs';
const [action='help',input]=process.argv.slice(2),root=path.resolve(import.meta.dirname,'..');
if(action==='schema')console.log(JSON.stringify(workflowSchema,null,2));
else if(action==='help')console.log('workflow.mjs plan|run SPEC.json | inspect|resume_check|resume ARTIFACT_DIRECTORY | schema\nplan/inspect/resume_check never start EDA. run/resume execute the declared tools.');
else{
  const registry=new Map(),extension=await createJiti(import.meta.url).import('../src/extension.ts',{default:true});
  extension({registerTool:t=>registry.set(t.name,t)});
  const abort=new AbortController();process.on('SIGINT',()=>abort.abort());
  try{
    if(!['plan','run','inspect','resume_check','resume'].includes(action)||!input)throw new Error('Unknown action or missing workflow input');
    const result=await registry.get(`eda_workflow_${action}`).execute(`workflow-cli-${Date.now()}`,['plan','run'].includes(action)?{spec:input}:{directory:input},abort.signal);
    console.log(JSON.stringify(result.details,null,2));if(result.isError)process.exitCode=1;
  }catch(e){console.error(e.message);process.exitCode=1;}
}
