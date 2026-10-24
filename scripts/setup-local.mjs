// Generates machine-local MCP launch configuration. Does not start EDA or a model.
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const quote=s=>JSON.stringify(s.replaceAll('\\','/'));
const native={command:'node',args:[path.join(root,'src/mcp-server.mjs')],cwd:root,timeout:4800};
const proxy=name=>({command:'node',args:[path.join(root,'src/traced-mcp-proxy.mjs'),name],cwd:root,timeout: name==='ltspice'?1100:2200});
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
function write(file,text){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(fs.existsSync(file)){
    if(!process.argv.includes('--replace')){console.log(`Preserved existing ${path.relative(root,file)} (use --replace to back up and replace)`);return;}
    const backup=fs.mkdtempSync(path.join(root,'artifacts/config-backup-'));
    fs.copyFileSync(file,path.join(backup,path.basename(file)));
  }
  fs.writeFileSync(file,text);
}
write(path.join(root,'.pi/mcp.json'),JSON.stringify({mcpServers:{'eda-local':native,'vivado-community':proxy('vivado-community'),ltspice:proxy('ltspice')}},null,2)+'\n');
write(path.join(root,'.codex/config.toml'),['eda-local','vivado-community'].map(name=>{
  const c=name==='eda-local'?native:proxy(name);
  return `[mcp_servers.${name}]\ncommand = "node"\nargs = [${c.args.map(quote).join(', ')}]\ncwd = ${quote(root)}\nstartup_timeout_sec = 30\ntool_timeout_sec = ${c.timeout}\n`;
}).join('\n'));
console.log('Local MCP configuration ready. Set EDA_VIVADO_BIN to the installed Vivado bin directory; reconnect clients. Model policy is unchanged.');
