// Build script for echo-taskbar-host.exe (pure Win32 + Direct2D AppBar)
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const sourceDir = join(projectRoot, 'native', 'taskbar-host');
const buildDir = join(projectRoot, 'out', 'native', 'taskbar-host');
const targetDir = join(projectRoot, 'electron-app', 'build');
const targetExe = join(targetDir, 'echo-taskbar-host.exe');
const config = process.env.ECHO_TASKBAR_HOST_CONFIG || 'Release';
const isWindows = process.platform === 'win32';

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
};

const findBuiltExe = () => {
  const candidates = [
    join(buildDir, 'Release', 'echo-taskbar-host.exe'),
    join(buildDir, 'echo-taskbar-host.exe'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
};

try {
  if (!isWindows) {
    console.log('[build:taskbar-host] Skipped: Windows-only module.');
    process.exit(0);
  }

  const configureArgs = [
    '-S', sourceDir,
    '-B', buildDir,
    '-G', 'Visual Studio 17 2022',
    '-A', 'x64',
  ];

  run('cmake', configureArgs);
  run('cmake', ['--build', buildDir, '--config', config, '--parallel']);

  const builtExe = findBuiltExe();
  if (!builtExe) {
    throw new Error(`Built binary was not found under ${buildDir}`);
  }

  mkdirSync(targetDir, { recursive: true });
  copyFileSync(builtExe, targetExe);
  console.log(`[build:taskbar-host] Copied ${builtExe}`);
  console.log(`[build:taskbar-host]      -> ${targetExe}`);

} catch (error) {
  console.error('[build:taskbar-host] Failed to build taskbar host.');
  console.error('[build:taskbar-host] Requirements: CMake, Visual Studio 2022 Build Tools, Windows SDK.');
  console.error(`[build:taskbar-host] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
