import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const electronViteBin = join(projectRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js');

const result = spawnSync(process.execPath, [electronViteBin, 'build'], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
