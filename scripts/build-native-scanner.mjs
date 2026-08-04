import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const sourceDir = join(projectRoot, 'native', 'library-scanner');
const buildDir = join(projectRoot, 'out', 'native', 'library-scanner');
const targetDir = join(projectRoot, 'electron-app', 'build');
const executableName = process.platform === 'win32' ? 'echo-native-scanner.exe' : 'echo-native-scanner';
const targetExe = join(targetDir, executableName);
const config = process.env.ECHO_NATIVE_SCANNER_CONFIG || 'Release';
const lockPath = join(buildDir, '.build.lock');
const lockTimeoutMs = Number(process.env.ECHO_NATIVE_SCANNER_BUILD_LOCK_TIMEOUT_MS ?? 120_000);

const sleep = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const acquireBuildLock = () => {
  mkdirSync(buildDir, { recursive: true });
  const startedAt = Date.now();

  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx');
      writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
      return () => {
        closeSync(fd);
        rmSync(lockPath, { force: true });
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
      if (Date.now() - startedAt > lockTimeoutMs) {
        throw new Error(`Timed out waiting for native scanner build lock: ${lockPath}`);
      }
      sleep(250);
    }
  }
};

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

const findBuiltScanner = () => {
  const candidates = [
    join(buildDir, config, executableName),
    join(buildDir, executableName),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
};

let releaseBuildLock = null;

try {
  releaseBuildLock = acquireBuildLock();
  if (process.platform === 'win32') {
    run('cmake', [
      '-S',
      sourceDir,
      '-B',
      buildDir,
      '-G',
      'Visual Studio 17 2022',
      '-A',
      'x64',
    ]);
    run('cmake', ['--build', buildDir, '--config', config, '--parallel']);
  } else {
    run('cmake', ['-S', sourceDir, '-B', buildDir, '-DCMAKE_BUILD_TYPE=Release']);
    run('cmake', ['--build', buildDir, '--parallel']);
  }

  const builtScanner = findBuiltScanner();
  if (!builtScanner) {
    throw new Error(`Built native scanner binary was not found under ${buildDir}`);
  }

  mkdirSync(targetDir, { recursive: true });
  copyFileSync(builtScanner, targetExe);
  console.log(`[build:native-scanner] Copied ${builtScanner}`);
  console.log(`[build:native-scanner]      -> ${targetExe}`);
} catch (error) {
  console.error('[build:native-scanner] Failed to build native file scanner.');
  console.error('[build:native-scanner] Requirements: CMake and a C++17 compiler. On Windows use Visual Studio 2022 Build Tools.');
  console.error(`[build:native-scanner] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
} finally {
  releaseBuildLock?.();
}
