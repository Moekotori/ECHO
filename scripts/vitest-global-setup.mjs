import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');

export default function setup() {
  if (process.env.ECHO_SKIP_NATIVE_ABI === '1') {
    return;
  }

  const result = spawnSync(process.execPath, [join(projectRoot, 'scripts', 'ensure-native-abi.mjs'), 'node'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Failed to align better-sqlite3 with the Node ABI before Vitest exited with code ${result.status}.`);
  }
}
