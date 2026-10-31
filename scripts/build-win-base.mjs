import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const projectRoot = process.cwd();
// Tests can switch SQLite back to the Node ABI after the source build.
const nativePreparation = spawnSync(process.execPath, [join(projectRoot, 'scripts', 'ensure-native-abi.mjs'), 'electron'], {
  cwd: projectRoot,
  stdio: 'inherit',
});
if (nativePreparation.error) throw nativePreparation.error;
if (nativePreparation.status !== 0) process.exit(nativePreparation.status ?? 1);

const electronBuilderCli = join(projectRoot, 'node_modules', 'electron-builder', 'cli.js');
const child = spawn(
  process.execPath,
  [electronBuilderCli, '--win', '--publish', 'never'],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    },
    stdio: 'inherit',
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  if (code !== 0) process.exit(code ?? 1);
  const verification = spawnSync(process.execPath, [join(projectRoot, 'scripts', 'verify-packaged-sqlite.mjs')], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  if (verification.error) throw verification.error;
  process.exit(verification.status ?? 1);
});
