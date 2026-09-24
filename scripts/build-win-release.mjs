import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const publisherName = process.env.ECHO_WINDOWS_PUBLISHER_NAME?.trim();
if (!publisherName) {
  throw new Error(
    'ECHO_WINDOWS_PUBLISHER_NAME is required for release builds and must match the Authenticode certificate publisher.',
  );
}

const electronBuilderCli = fileURLToPath(new URL('../node_modules/electron-builder/cli.js', import.meta.url));
const result = spawnSync(
  process.execPath,
  [
    electronBuilderCli,
    '--win',
    '--publish',
    'never',
    `--config.win.signtoolOptions.publisherName=${publisherName}`,
    '--config.win.verifyUpdateCodeSignature=true',
  ],
  { cwd: fileURLToPath(new URL('..', import.meta.url)), env: process.env, stdio: 'inherit' },
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
