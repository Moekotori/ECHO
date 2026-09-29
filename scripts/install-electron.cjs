const path = require('node:path');
const { spawnSync } = require('node:child_process');

process.env.electron_config_cache =
  process.env.electron_config_cache || path.resolve(__dirname, '..', '.electron-cache');

const projectRoot = path.resolve(__dirname, '..');
const installElectronBin = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'install-electron.cmd' : 'install-electron',
);

const result = spawnSync(installElectronBin, [], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(`[install-electron] ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
