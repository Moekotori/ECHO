import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const sourceDir = join(projectRoot, 'native', 'audio-host');
const buildDir = join(projectRoot, 'out', 'native', 'audio-host');
const config = process.env.ECHO_AUDIO_HOST_CONFIG || 'Release';
const enableAsio = process.env.ECHO_ENABLE_ASIO ?? (process.platform === 'win32' ? 'ON' : 'OFF');
const isWindows = process.platform === 'win32';
const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
};

try {
  const configureArgs = [
    '-S',
    sourceDir,
    '-B',
    buildDir,
    `-DECHO_ENABLE_ASIO=${enableAsio}`,
  ];

  if (isWindows) {
    configureArgs.push('-G', 'Visual Studio 17 2022', '-A', 'x64');
  } else {
    configureArgs.push(`-DCMAKE_BUILD_TYPE=${config}`);
  }

  run('cmake', configureArgs);
  run(
    'cmake',
    isWindows
      ? ['--build', buildDir, '--config', config, '--target', 'echo-audio-engine-tests', '--parallel']
      : ['--build', buildDir, '--target', 'echo-audio-engine-tests', '--parallel'],
  );
  run('ctest', isWindows ? ['--test-dir', buildDir, '-C', config, '--output-on-failure'] : ['--test-dir', buildDir, '--output-on-failure']);
} catch (error) {
  console.error('[test:audio-engine] Failed.');
  console.error(
    isWindows
      ? '[test:audio-engine] Requirements: CMake, Visual Studio 2022 Build Tools, Windows SDK, and native audio backend dependencies.'
      : '[test:audio-engine] Requirements: CMake, a C++17 compiler, Linux audio development libraries and native audio backend dependencies.',
  );
  console.error(`[test:audio-engine] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
