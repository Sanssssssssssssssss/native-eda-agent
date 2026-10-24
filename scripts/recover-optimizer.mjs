import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { prepareRecovery } from '../src/optimizer-recovery.mjs';
const root = path.resolve(import.meta.dirname, '..');
const [input, action = '--check-only'] = process.argv.slice(2);
if (!input || !['--check-only','--run'].includes(action)) throw new Error('Usage: node scripts/recover-optimizer.mjs RUN_DIR [--check-only|--run]');
const checked = prepareRecovery(root,input);
console.log(JSON.stringify({ ready: checked.ready, issues: checked.issues, warnings: checked.warnings,
  source_run_id: checked.source_run_id, remaining_plays: checked.remaining_plays, boundary: checked.boundary },null,2));
if (!checked.ready) process.exitCode = 1;
else if (action === '--run') {
  const dir = path.join(root,'artifacts',`optimizer-recovery-request-${randomUUID()}`); fs.mkdirSync(dir);
  const file = path.join(dir,'arguments.json');
  fs.writeFileSync(file,JSON.stringify({resume_from:input,mode:'run'},null,2));
  const result = spawnSync(process.execPath,[path.join(root,'scripts/eda-tool.mjs'),'eda_vivado_optimize',file],{cwd:root,stdio:'inherit',windowsHide:true});
  process.exitCode = result.status ?? 1;
}
