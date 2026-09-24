import { spawnSync } from 'node:child_process';

const useMirror = process.argv.includes('--mirror');

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`Unable to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
};

console.log('Checking the ECHO development toolchain...');
run(process.execPath, ['scripts/doctor.mjs']);

if (useMirror) {
  console.log('\nConfiguring mainland China download mirrors...');
  run(process.execPath, ['scripts/setup-mirror.mjs']);
  process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/';
}

console.log('\nInstalling the exact dependencies from package-lock.json...');
if (!process.env.npm_execpath) {
  console.error('npm run setup must be launched through npm so the pinned package manager can be reused.');
  process.exit(1);
}
run(process.execPath, [process.env.npm_execpath, 'ci']);

console.log('\nECHO development setup is ready. Start with: npm run dev');
