import { spawn } from 'node:child_process';
import { join } from 'node:path';

const projectRoot = process.cwd();
const electronBuilderCli = join(projectRoot, 'node_modules', 'electron-builder', 'cli.js');

const child = spawn(
  process.execPath,
  [electronBuilderCli, '--win', '--publish', 'never'],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      ECHO_ALLOW_UNSIGNED_BASE_PACKAGE: '1',
    },
    stdio: 'inherit',
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
