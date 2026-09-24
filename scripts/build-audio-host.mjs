import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const sourceDir = join(projectRoot, 'native', 'audio-host');
const buildDir = join(projectRoot, 'out', 'native', 'audio-host');
const targetDir = join(projectRoot, 'electron-app', 'build');
const targetExe = join(targetDir, process.platform === 'win32' ? 'echo-audio-host.exe' : 'echo-audio-host');
const packagedAppDir = process.platform === 'win32'
  ? 'win-unpacked'
  : process.platform === 'darwin'
    ? process.arch === 'arm64' ? 'mac-arm64' : 'mac'
    : 'linux-unpacked';
const packagedResourceExe = join(
  projectRoot,
  'dist',
  packagedAppDir,
  'resources',
  process.platform === 'win32' ? 'echo-audio-host.exe' : 'echo-audio-host',
);
const config = process.env.ECHO_AUDIO_HOST_CONFIG || 'Release';
const enableAsio = process.env.ECHO_ENABLE_ASIO ?? (process.platform === 'win32' ? 'ON' : 'OFF');
const enableCudaDsp = process.env.ECHO_ENABLE_CUDA_DSP?.trim();
const isWindows = process.platform === 'win32';
const requireCudaDsp = process.argv.includes('--require-cuda') || process.env.ECHO_REQUIRE_CUDA_DSP === '1';
const cudaBuildMarkerPath = join(buildDir, '.echo-cuda-toolkit');

const isFfmpegDevRoot = (candidate) =>
  Boolean(
    candidate &&
      existsSync(join(candidate, 'include', 'libavcodec', 'avcodec.h')) &&
      existsSync(join(candidate, 'lib', 'avcodec.lib')) &&
      existsSync(join(candidate, 'bin')),
  );

const findWindowsFfmpegDevRoot = () => {
  const explicitRoot = process.env.ECHO_FFMPEG_DEV_ROOT?.trim();
  if (isFfmpegDevRoot(explicitRoot)) {
    return explicitRoot;
  }

  const packagesRoot = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages')
    : null;
  if (!packagesRoot || !existsSync(packagesRoot)) {
    return null;
  }

  for (const packageName of readdirSync(packagesRoot)) {
    if (!packageName.startsWith('Gyan.FFmpeg.Shared_')) {
      continue;
    }
    const packageRoot = join(packagesRoot, packageName);
    for (const versionDirectory of readdirSync(packageRoot).sort().reverse()) {
      const candidate = join(packageRoot, versionDirectory);
      if (isFfmpegDevRoot(candidate)) {
        return candidate;
      }
    }
  }

  return null;
};

const findWindowsCudaToolkitRoot = () => {
  if (!isWindows) {
    return null;
  }
  const explicitRoot = process.env.CUDA_PATH || process.env.CUDAToolkit_ROOT;
  if (explicitRoot && existsSync(join(explicitRoot, 'bin', 'nvcc.exe'))) {
    return explicitRoot;
  }
  const toolkitRoot = join('C:\\', 'Program Files', 'NVIDIA GPU Computing Toolkit', 'CUDA');
  if (!existsSync(toolkitRoot)) {
    return null;
  }
  const versions = readdirSync(toolkitRoot)
    .filter((name) => /^v\d+(?:\.\d+)*$/u.test(name) && existsSync(join(toolkitRoot, name, 'bin', 'nvcc.exe')))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  return versions.length > 0 ? join(toolkitRoot, versions[0]) : null;
};

const prepareCudaBuildTree = (cudaToolkitRoot) => {
  const signature = cudaToolkitRoot ?? 'cpu-fallback';
  const previousSignature = existsSync(cudaBuildMarkerPath)
    ? readFileSync(cudaBuildMarkerPath, 'utf8').trim()
    : null;
  if (previousSignature !== signature && existsSync(join(buildDir, 'CMakeCache.txt'))) {
    // The Visual Studio generator cannot change its CUDA toolset in place.
    // This path is fixed under the repository's native build output.
    rmSync(buildDir, { recursive: true, force: true });
  }
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(cudaBuildMarkerPath, `${signature}\n`, 'utf8');
};
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

const quotePowerShellString = (value) => `'${String(value).replace(/'/g, "''")}'`;

const stopRunningTargetBinary = (filePath) => {
  if (!isWindows || !existsSync(filePath)) {
    return;
  }

  const escapedPath = quotePowerShellString(resolve(filePath));
  const command = [
    `$target = ${escapedPath}`,
    '$processes = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $target }',
    'foreach ($process in $processes) {',
    '  Write-Output ("[build:audio-host] Stopping locked target process PID " + $process.ProcessId + ": " + $target)',
    '  Stop-Process -Id $process.ProcessId -Force',
    '}',
  ].join('; ');

  const result = spawnSync('powershell', ['-NoProfile', '-Command', command], {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (output) {
    console.log(output);
  }

  if (result.status !== 0) {
    throw new Error(`Failed to stop locked target process for ${filePath}`);
  }
};

const copyBuiltHost = (source, destination) => {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    stopRunningTargetBinary(destination);
    try {
      copyFileSync(source, destination);
      return;
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[build:audio-host] Copy attempt ${attempt} failed, retrying: ${message}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 350 * attempt);
    }
  }
};

const findBuiltHost = () => {
  const exe = process.platform === 'win32' ? 'echo-audio-host.exe' : 'echo-audio-host';
  const candidates = [
    join(buildDir, 'echo-audio-host_artefacts', config, exe),
    join(buildDir, config, exe),
    join(buildDir, exe),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
};

try {
  const cudaToolkitRoot = findWindowsCudaToolkitRoot();
  if (isWindows && requireCudaDsp && !cudaToolkitRoot) {
    throw new Error(
      'CUDA DSP is required for this build, but a CUDA Toolkit with nvcc was not found. ' +
      'Install the minimal nvcc/cudart/Visual Studio integration components or set CUDA_PATH.',
    );
  }
  prepareCudaBuildTree(cudaToolkitRoot);
  const configureArgs = [
    '-S',
    sourceDir,
    '-B',
    buildDir,
    `-DECHO_ENABLE_ASIO=${enableAsio}`,
  ];
  if (enableCudaDsp) {
    configureArgs.push(`-DECHO_ENABLE_CUDA_DSP=${enableCudaDsp}`);
  }

  if (isWindows) {
    configureArgs.push('-G', 'Visual Studio 17 2022', '-A', 'x64');
    const ffmpegDevRoot = findWindowsFfmpegDevRoot();
    if (!ffmpegDevRoot) {
      throw new Error(
        'FFmpeg development files were not found. Install Gyan.FFmpeg.Shared with winget or set ECHO_FFMPEG_DEV_ROOT.',
      );
    }
    configureArgs.push(`-DECHO_FFMPEG_ROOT=${ffmpegDevRoot}`);
    if (cudaToolkitRoot) {
      configureArgs.push('-T', `cuda=${cudaToolkitRoot}`, `-DCUDAToolkit_ROOT=${cudaToolkitRoot}`);
      console.log(`[build:audio-host] Using in-process CUDA DSP toolkit: ${cudaToolkitRoot}`);
    }
  } else {
    configureArgs.push(`-DCMAKE_BUILD_TYPE=${config}`);
  }

  run('cmake', configureArgs);
  run('cmake', isWindows ? ['--build', buildDir, '--config', config, '--parallel'] : ['--build', buildDir, '--parallel']);

  const builtHost = findBuiltHost();

  if (!builtHost) {
    throw new Error(`Built host binary was not found under ${buildDir}`);
  }

  mkdirSync(targetDir, { recursive: true });
  copyBuiltHost(builtHost, targetExe);
  if (isWindows) {
    const ffmpegDevRoot = findWindowsFfmpegDevRoot();
    for (const name of readdirSync(join(ffmpegDevRoot, 'bin'))) {
      if (/^(?:avcodec|avdevice|avfilter|avformat|avutil|swresample|swscale)-\d+\.dll$/i.test(name)) {
        copyBuiltHost(join(ffmpegDevRoot, 'bin', name), join(targetDir, name));
      }
    }
  }
  if (!isWindows) {
    chmodSync(targetExe, 0o755);
  }
  console.log(`[build:audio-host] Copied ${builtHost}`);
  console.log(`[build:audio-host]      -> ${targetExe}`);

  if (existsSync(packagedResourceExe)) {
    copyBuiltHost(builtHost, packagedResourceExe);
    console.log(`[build:audio-host]      -> ${packagedResourceExe}`);
  }
} catch (error) {
  console.error('[build:audio-host] Failed to build native audio host.');
  console.error(
    isWindows
      ? '[build:audio-host] Requirements: CMake, Visual Studio 2022 Build Tools, Windows SDK, and native audio backend dependencies.'
      : process.platform === 'darwin'
        ? '[build:audio-host] Requirements: CMake, a C++17 compiler, pkg-config, FFmpeg development libraries, and CoreAudio.'
        : '[build:audio-host] Requirements: CMake, a C++17 compiler, Linux audio development libraries and native audio backend dependencies.',
  );
  console.error(`[build:audio-host] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
