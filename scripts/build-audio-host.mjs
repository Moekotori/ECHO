import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const sourceDir = join(projectRoot, 'native', 'audio-host');
const buildDir = join(projectRoot, 'out', 'native', 'audio-host');
const targetDir = join(projectRoot, 'electron-app', 'build');
const targetExe = join(targetDir, process.platform === 'win32' ? 'echo-audio-host.exe' : 'echo-audio-host');
const packagedAppDir = process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked';
const packagedResourceExe = join(
  projectRoot,
  'dist',
  packagedAppDir,
  'resources',
  process.platform === 'win32' ? 'echo-audio-host.exe' : 'echo-audio-host',
);
const config = process.env.ECHO_AUDIO_HOST_CONFIG || 'Release';
const enableAsio = process.env.ECHO_ENABLE_ASIO ?? (process.platform === 'win32' ? 'ON' : 'OFF');
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
  run('cmake', isWindows ? ['--build', buildDir, '--config', config, '--parallel'] : ['--build', buildDir, '--parallel']);

  const builtHost = findBuiltHost();

  if (!builtHost) {
    throw new Error(`Built host binary was not found under ${buildDir}`);
  }

  mkdirSync(targetDir, { recursive: true });
  copyBuiltHost(builtHost, targetExe);
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
      : '[build:audio-host] Requirements: CMake, a C++17 compiler, Linux audio development libraries and native audio backend dependencies.',
  );
  console.error(`[build:audio-host] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
