// Launch only the official AMD binary after it has been downloaded by the user.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, '.eda/ross.json'), 'utf8'));
const binary = path.resolve(root, config.binary);
if (!fs.existsSync(binary)) {
  console.error(`ROSS_BINARY_MISSING: download the AMD standalone Windows package from ${config.download_page} and place it at ${binary}. Skills are available; the official MCP has not been connected.`);
  process.exitCode = 2;
} else {
  const child = spawn(binary, ['--stdio-bridge'], { cwd: root, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, VIVADO_PATH: config.vivado_path } });
  child.on('error', e => { console.error(String(e)); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}
