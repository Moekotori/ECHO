import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  process.exit(0);
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(process.execPath, [join(projectRoot, 'scripts', 'prepare-win-ffmpeg.mjs')], {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`[ensure:dev-audio-runtime] ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
