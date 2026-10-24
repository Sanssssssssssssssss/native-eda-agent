import fs from 'node:fs';
import path from 'node:path';
import { createJiti } from 'jiti';
import {fpgaSurfaces,platformSurfaces} from '../src/tools/focused.mjs';
const root=path.resolve(import.meta.dirname,'..');
const extension=await createJiti(import.meta.url).import('../src/extension.ts',{default:true});
const tools=[];extension({registerTool:t=>tools.push(t)});
const records=tools.map(t=>{
  const surface=[...fpgaSurfaces,...platformSurfaces].find(s=>s.name===t.name);
  const launches_eda=t.name.startsWith('eda_vivado')||['eda_xsim','eda_ltspice_batch','eda_benchmark_run','eda_benchmark','eda_workflow_run','eda_workflow_resume'].includes(t.name);
  return {name:t.name,description:t.description,inputSchema:t.parameters,executor:surface?.base||t.name,fixed_selector:surface?.fixed||null,
    launches_eda,execution_note:t.name==='eda_benchmark'?'Only action=run launches EDA':t.name==='eda_vivado_optimize'?'Both plan and run launch Vivado':launches_eda?'Requires installed EDA software':'Offline local inspection/control',writes_local_evidence:true,model_api_calls:0};
});
const catalog={schema_version:1,native_interfaces:records.length,focused_interfaces:fpgaSurfaces.length+platformSurfaces.length,community_interfaces:45,community_prompts:11,counting:'Interface count, not independent engines, actions or benchmark tasks.',tools:records};
if(process.argv.includes('--write')){
  fs.mkdirSync(path.join(root,'docs/reference'),{recursive:true});
  fs.writeFileSync(path.join(root,'docs/reference/tools.json'),JSON.stringify(catalog,null,2)+'\n');
  fs.writeFileSync(path.join(root,'docs/reference/tools.md'),`# Native tool contracts\n\n${records.length} native interfaces. ${catalog.focused_interfaces} are focused contracts over shared executors; 4 expose retained scores. Community MCP separately exposes 45 tools and 11 prompts.\n\nSchemas: [tools.json](tools.json). Real EDA calls write independent artifacts and use shared resource leases.\n\n| Tool | Executor | Runs EDA | Purpose |\n|---|---|---|---|\n`+records.map(t=>`| \`${t.name}\` | \`${t.executor}\` | ${t.launches_eda?'Yes / see schema':'No'} | ${t.description} |`).join('\n')+'\n');
  console.log(JSON.stringify({native:records.length,focused:catalog.focused_interfaces}));
}else console.log(JSON.stringify(catalog,null,2));
