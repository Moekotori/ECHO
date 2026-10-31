import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const sourceDir = join(projectRoot, 'native', 'smtc-host');
const buildDir = join(projectRoot, 'out', 'native', 'smtc-host');
const targetDir = join(projectRoot, 'electron-app', 'build');
const targetExe = join(targetDir, 'echo-smtc-host.exe');
const packagedResourceExe = join(projectRoot, 'dist', 'win-unpacked', 'resources', 'echo-smtc-host.exe');
const config = process.env.ECHO_SMTC_HOST_CONFIG || 'Release';

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

const quotePowerShellString = (value) => `'${String(value).replace(/'/g, "''")}'`;

const stopRunningTargetBinary = (filePath) => {
  if (process.platform !== 'win32' || !existsSync(filePath)) {
    return;
  }

  const escapedPath = quotePowerShellString(resolve(filePath));
  const command = [
    `$target = ${escapedPath}`,
    '$processes = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $target }',
    'foreach ($process in $processes) {',
    '  Write-Output ("[build:smtc-host] Stopping locked target process PID " + $process.ProcessId + ": " + $target)',
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
  let lastError = null;

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      stopRunningTargetBinary(destination);
      copyFileSync(source, destination);
      return;
    } catch (error) {
      lastError = error;

      if (process.platform !== 'win32' || attempt === 10) {
        break;
      }

      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }

  throw lastError;
};

const findBuiltHost = () => {
  const candidates = [
    join(buildDir, config, 'echo-smtc-host.exe'),
    join(buildDir, 'echo-smtc-host.exe'),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
};

try {
  if (process.platform !== 'win32') {
    console.log('[build:smtc-host] Skipping Windows-only SMTC host build on this platform.');
    process.exit(0);
  }

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

  const builtHost = findBuiltHost();
  if (!builtHost) {
    throw new Error(`Built SMTC host binary was not found under ${buildDir}`);
  }

  mkdirSync(targetDir, { recursive: true });
  copyBuiltHost(builtHost, targetExe);
  console.log(`[build:smtc-host] Copied ${builtHost}`);
  console.log(`[build:smtc-host]      -> ${targetExe}`);

  if (existsSync(packagedResourceExe)) {
    copyBuiltHost(builtHost, packagedResourceExe);
    console.log(`[build:smtc-host]      -> ${packagedResourceExe}`);
  }
} catch (error) {
  console.error('[build:smtc-host] Failed to build Windows SMTC host.');
  console.error('[build:smtc-host] Requirements: CMake, Visual Studio 2022 Build Tools, and Windows SDK 10.0.19041 or newer.');
  console.error(`[build:smtc-host] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
