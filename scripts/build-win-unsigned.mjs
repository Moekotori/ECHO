import { spawn } from 'node:child_process';
import { join } from 'node:path';

const projectRoot = process.cwd();
const electronBuilderCli = join(projectRoot, 'node_modules', 'electron-builder', 'cli.js');

const child = spawn(
  process.execPath,
  [electronBuilderCli, '--win', '--publish', 'never', '--config.win.signAndEditExecutable=false'],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      NODE_NO_WARNINGS: '1',
    },
    shell: false,
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
