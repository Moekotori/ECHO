import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const sourceDir = join(projectRoot, 'native', 'src-cuda-worker');
const buildDir = join(projectRoot, 'out', 'native', 'src-cuda-worker');
const targetDir = join(projectRoot, 'electron-app', 'build');
const executableName = process.platform === 'win32' ? 'echo-src-cuda-worker.exe' : 'echo-src-cuda-worker';
const targetExe = join(targetDir, executableName);
const config = process.env.ECHO_SRC_CUDA_WORKER_CONFIG || 'Release';
const lockPath = join(buildDir, '.build.lock');
const lockTimeoutMs = Number(process.env.ECHO_SRC_CUDA_WORKER_BUILD_LOCK_TIMEOUT_MS ?? 120_000);

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
        throw new Error(`Timed out waiting for SRC CUDA worker build lock: ${lockPath}`);
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

const resolveWindowsCudaToolkitDir = () => {
  const explicit = process.env.CUDA_PATH || process.env.CUDAToolkit_ROOT;
  if (explicit && existsSync(join(explicit, 'bin', 'nvcc.exe'))) {
    return explicit;
  }

  const root = join('C:\\', 'Program Files', 'NVIDIA GPU Computing Toolkit', 'CUDA');
  if (!existsSync(root)) {
    return null;
  }

  const versions = readdirSync(root)
    .filter((name) => /^v\d+(?:\.\d+)*$/u.test(name) && existsSync(join(root, name, 'bin', 'nvcc.exe')))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));

  return versions.length > 0 ? join(root, versions[0]) : null;
};

const findBuiltWorker = () => {
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
    const configureArgs = [
      '-S',
      sourceDir,
      '-B',
      buildDir,
      '-G',
      'Visual Studio 17 2022',
      '-A',
      'x64',
    ];
    const cudaToolkitDir = resolveWindowsCudaToolkitDir();
    if (cudaToolkitDir) {
      configureArgs.push('-T', `cuda=${cudaToolkitDir}`);
      console.log(`[build:src-cuda-worker] Using CUDA Toolkit: ${cudaToolkitDir}`);
    }
    run('cmake', configureArgs);
    run('cmake', ['--build', buildDir, '--config', config, '--parallel']);
  } else {
    run('cmake', ['-S', sourceDir, '-B', buildDir, '-DCMAKE_BUILD_TYPE=Release']);
    run('cmake', ['--build', buildDir, '--parallel']);
  }

  const builtWorker = findBuiltWorker();
  if (!builtWorker) {
    throw new Error(`Built SRC CUDA worker binary was not found under ${buildDir}`);
  }

  mkdirSync(targetDir, { recursive: true });
  copyFileSync(builtWorker, targetExe);
  console.log(`[build:src-cuda-worker] Copied ${builtWorker}`);
  console.log(`[build:src-cuda-worker]      -> ${targetExe}`);
} catch (error) {
  console.error('[build:src-cuda-worker] Failed to build SRC CUDA worker.');
  console.error('[build:src-cuda-worker] Requirements: CMake and a C++17 compiler. CUDA Toolkit with NVCC enables GPU FIR; without it the worker builds CPU-only.');
  console.error(`[build:src-cuda-worker] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
} finally {
  releaseBuildLock?.();
}
