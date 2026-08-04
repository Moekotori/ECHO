import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const sourceRoot = join(projectRoot, 'native', 'src-cuda-worker');
const buildScriptPath = join(projectRoot, 'scripts', 'build-src-cuda-worker.mjs');
const config = process.env.ECHO_SRC_CUDA_WORKER_CONFIG || 'Release';
const executableName = process.platform === 'win32' ? 'echo-src-cuda-worker.exe' : 'echo-src-cuda-worker';
const targetPath = join(projectRoot, 'electron-app', 'build', executableName);
const markerPath = join(projectRoot, 'electron-app', 'build', '.echo-src-cuda-worker.ensure.json');

const getLatestSourceMtime = (directory) => {
  let latest = 0;

  if (!existsSync(directory)) {
    return latest;
  }

  for (const name of readdirSync(directory)) {
    const filePath = join(directory, name);
    const stats = statSync(filePath);

    if (stats.isDirectory()) {
      latest = Math.max(latest, getLatestSourceMtime(filePath));
    } else {
      latest = Math.max(latest, stats.mtimeMs);
    }
  }

  return latest;
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

const getTargetStats = () => {
  if (!existsSync(targetPath)) {
    return null;
  }

  const stats = statSync(targetPath);
  return {
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
};

const readMarker = () => {
  if (!existsSync(markerPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(markerPath, 'utf8'));
  } catch {
    return null;
  }
};

const isCurrent = (latestSourceMtime) => {
  const marker = readMarker();
  const targetStats = getTargetStats();
  const buildScriptMtime = statSync(buildScriptPath).mtimeMs;

  return Boolean(
    marker &&
      targetStats &&
      marker.platform === process.platform &&
      marker.arch === process.arch &&
      marker.config === config &&
      marker.latestSourceMtime === latestSourceMtime &&
      marker.buildScriptMtime === buildScriptMtime &&
      marker.target?.size === targetStats.size &&
      marker.target?.mtimeMs === targetStats.mtimeMs,
  );
};

const writeMarker = (latestSourceMtime) => {
  const targetStats = getTargetStats();
  if (!targetStats) {
    return;
  }

  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(
    markerPath,
    `${JSON.stringify(
      {
        platform: process.platform,
        arch: process.arch,
        config,
        latestSourceMtime,
        buildScriptMtime: statSync(buildScriptPath).mtimeMs,
        target: targetStats,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
};

try {
  if (process.env.ECHO_SKIP_SRC_CUDA_WORKER_BUILD === '1') {
    console.log('[ensure:src-cuda-worker] skipped because ECHO_SKIP_SRC_CUDA_WORKER_BUILD=1');
    process.exit(0);
  }

  const targetMtime = existsSync(targetPath) ? statSync(targetPath).mtimeMs : 0;
  const latestSourceMtime = getLatestSourceMtime(sourceRoot);

  if (targetMtime > 0 && (targetMtime >= latestSourceMtime || isCurrent(latestSourceMtime))) {
    console.log(`[ensure:src-cuda-worker] ${targetPath} is up to date.`);
    process.exit(0);
  }

  if (targetMtime > 0) {
    console.log('[ensure:src-cuda-worker] SRC CUDA worker is older than source; rebuilding...');
  } else {
    console.log('[ensure:src-cuda-worker] SRC CUDA worker is missing; building...');
  }

  run(process.execPath, [join(projectRoot, 'scripts', 'build-src-cuda-worker.mjs')]);
  writeMarker(latestSourceMtime);
} catch (error) {
  console.error('[ensure:src-cuda-worker] SRC CUDA worker is required for CUDA FIR acceleration.');
  console.error('[ensure:src-cuda-worker] Requirements: CMake and a C++17 compiler. CUDA Toolkit with NVCC enables GPU FIR; without it the worker builds CPU-only.');
  console.error(`[ensure:src-cuda-worker] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
