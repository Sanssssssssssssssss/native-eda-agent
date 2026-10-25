import fs from 'node:fs';
import path from 'node:path';

export const skillDirectories = ['.pi/skills','.agents/skills'];
// Auxiliary classifier/image calls bypass tool_call and the host verifier budget.
// Keep codemode as a tool orchestrator within the owning model session.
export const edaCodemodeOptions = Object.freeze({mode:'on',models:false});
export function edaResourceOptions({root,agentDir,settingsManager,extensionFactories=[]}) {
  const directories=skillDirectories.map(dir=>path.join(root,dir)).filter(dir=>fs.existsSync(dir));
  return {
    cwd:root,agentDir,settingsManager,
    noExtensions:true,noSkills:false,noContextFiles:true,
    additionalSkillPaths:directories,
    skillsOverride:base=>({...base,skills:base.skills.filter(skill=>directories.some(dir=>{
      const relative=path.relative(fs.realpathSync(dir),fs.realpathSync(skill.filePath));
      return relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);
    }))}),
    appendSystemPrompt:[fs.readFileSync(path.join(root,'.pi/APPEND_SYSTEM.md'),'utf8')],
    extensionFactories,
  };
}
