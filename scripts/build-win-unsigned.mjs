import { spawn } from 'node:child_process';
import { join } from 'node:path';

const projectRoot = process.cwd();
const electronBuilderCli = join(projectRoot, 'node_modules', 'electron-builder', 'cli.js');
const unsignedArtifactArgs = [
  '--config.nsis.artifactName=ECHO-NEXT-UNSIGNED-DEV-Setup-${version}.${ext}',
  '--config.portable.artifactName=ECHO-NEXT-UNSIGNED-DEV-Portable-${version}.${ext}',
];

console.warn('[build:win:unsigned] producing unsigned developer artifacts; these files must never be published.');

const child = spawn(
  process.execPath,
  [electronBuilderCli, '--win', '--publish', 'never', ...unsignedArtifactArgs],
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
