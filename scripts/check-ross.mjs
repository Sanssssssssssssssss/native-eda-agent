import fs from 'node:fs';
import path from 'node:path';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
const root = path.resolve(import.meta.dirname,'..');
const config = JSON.parse(fs.readFileSync(path.join(root,'.eda/ross.json'),'utf8'));
const settingsManager = SettingsManager.create(root,path.join(root,'.pi-state'));
const loader = new DefaultResourceLoader({cwd:root,agentDir:path.join(root,'.pi-state'),settingsManager,
  noExtensions:true,noContextFiles:true,additionalSkillPaths:[path.join(root,'.pi/skills'),path.join(root,'.agents/skills')]});
await loader.reload();
const {skills,diagnostics} = loader.getSkills();
const ross = skills.filter(s=>s.filePath.startsWith(path.join(root,'.agents/skills')));
const installed = path.join(root,'.agents/skills');
const data = {model_api_calls:0,official_mcp_connected:false,binary_present:fs.existsSync(path.join(root,config.binary)),
  pi_ross_skills:ross.length,pi_project_skills:skills.filter(s=>s.filePath.startsWith(path.join(root,'.pi/skills'))).length,
  codex_project_ross_skills:fs.existsSync(installed)?fs.readdirSync(installed).filter(x=>fs.existsSync(path.join(installed,x,'SKILL.md'))).length:0,
  source_commit:config.source_commit,diagnostics,skills:ross.map(s=>({name:s.name,path:s.filePath})),
  compatibility:'Upstream baseline 2026.1; local Vivado 2020.2. Command availability must be checked before using a skill.'};
fs.mkdirSync(path.join(root,'artifacts/ross-integration'),{recursive:true});
fs.writeFileSync(path.join(root,'artifacts/ross-integration/skills.json'),JSON.stringify(data,null,2));
console.log(JSON.stringify({...data,skills:undefined},null,2));
if(ross.length!==49)process.exitCode=1;
