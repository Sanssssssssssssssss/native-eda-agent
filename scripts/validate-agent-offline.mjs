// Reproducible acceptance for the agent plumbing. Never starts EDA/model sessions.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const directory=path.join(root,'artifacts',`agent-offline-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,6)}`);
fs.mkdirSync(directory,{recursive:true});
const python=path.join(root,'runtime/vivado-community-venv/Scripts/python.exe');
const report={schema_version:1,scope:'synthetic_agent_and_local_mcp_control_plane',started_at:new Date().toISOString(),directory,
  other_model_api_calls:0,vivado_runs:0,ltspice_runs:0,outer_codex_tokens:null,checks:[]};
const save=()=>fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(report,null,2));
function run(name,command,args){
  const start=Date.now(),result=spawnSync(command,args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:8*1024*1024});
  const output=(result.stdout||'')+(result.stderr||'');
  const log=path.join(directory,`${name}.log`);fs.writeFileSync(log,output);
  const count=name==='python'?Number(output.match(/Ran (\d+) tests/)?.[1]):name==='node'?Number(output.match(/\btests (\d+)/)?.[1]):null;
  report.checks.push({name,passed:result.status===0&&!result.error,exit_code:result.status,test_count:count,duration_ms:Date.now()-start,log,error:result.error?.message});save();
}
const nodeTests=['proxy-export','otlp-upload','optimizer-recovery','optimizer-trace','artifact-storage','replay-experiment','runtime','runtime-concurrency','mcp','trace','results-contracts','fpga-tools','benchmark','workflow'].map(name=>`tests/${name}.test.mjs`);
try {
  const config=JSON.parse(fs.readFileSync(path.join(root,'.eda/config.json')));
  if(config.model_api_enabled!==false) throw new Error('Offline acceptance requires model_api_enabled=false');
  const pi=JSON.parse(fs.readFileSync(path.join(root,'.pi/mcp.json')));
  if(!['vivado-community','ltspice'].every(key=>pi.mcpServers[key].args.some(value=>value.includes('traced-mcp-proxy.mjs')))) throw new Error('Proxy configuration not installed');
  run('node',process.execPath,['--test',...nodeTests]);
  run('python',python,['-m','unittest','discover','-s','tests','-p','test_fpga_optimizer.py']);
  run('config',python,['-c',"import tomllib; from pathlib import Path; c=tomllib.loads(Path('.codex/config.toml').read_text()); assert 'traced-mcp-proxy.mjs' in c['mcp_servers']['vivado-community']['args'][0]; print('Codex TOML proxy configuration valid')"]);
  const files=['src/traced-mcp-proxy.mjs','src/trace-export.mjs','src/optimizer-recovery.mjs','src/mcp-server.mjs','src/platform.mjs','src/trace.mjs','src/runtime.mjs','src/tools/optimizer.mjs','src/agent.mjs',
    'src/fpga_optimizer/recovery.py','src/fpga_optimizer/runner.py','src/fpga_optimizer/trace.py','scripts/optimize-vivado.py','scripts/export-traces.mjs','scripts/recover-optimizer.mjs',
    'src/otlp-upload.mjs','scripts/upload-traces.mjs','scripts/validate-agent-offline.mjs','tests/fixtures/proxy-backend.mjs','tests/test_fpga_optimizer.py',...nodeTests,
    'src/tool-contracts.mjs','src/tools/focused.mjs','src/results.mjs','src/tools/fpga.mjs','src/extension.ts','src/workflow.mjs','scripts/workflow.mjs','scripts/eda-tool.mjs','results/catalog.json',
    'package.json','.codex/config.toml','.pi/mcp.json','.pi/APPEND_SYSTEM.md','.eda/config.json','AGENTS.md','docs/agent-workflow-and-trace-contract.md','docs/agent-completion-2026-10-24.md'];
  report.source_hashes=Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
  report.passed=report.checks.every(c=>c.passed);
} catch(error){report.passed=false;report.error=error.message;}
report.finished_at=new Date().toISOString();save();
console.log(JSON.stringify({passed:report.passed,checks:report.checks.map(({name,passed,test_count})=>({name,passed,test_count})),evidence:directory,error:report.error},null,2));
if(!report.passed)process.exitCode=1;
