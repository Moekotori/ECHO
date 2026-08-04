import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const require = createRequire(import.meta.url);
const packageName = '@lox-audioserver/node-libraop';
const markerPath = join(projectRoot, 'node_modules', '.echo-airplay-raop.json');
const buildScriptPath = join(projectRoot, 'scripts', 'build-airplay-raop.mjs');
const ensureScriptPath = fileURLToPath(import.meta.url);
const prebuildNames = [
  'raop_addon.node.napi.node',
  'libssl-3-x64.dll',
  'libcrypto-3-x64.dll',
  'pthreadVC3.dll',
];

const executable = (name) => (process.platform === 'win32' ? `${name}.cmd` : name);
const normalizePathForCompare = (value) => resolve(value).toLowerCase();
const isUnderProjectNodeModules = (value) => {
  const normalized = normalizePathForCompare(value);
  const projectNodeModules = normalizePathForCompare(join(projectRoot, 'node_modules'));
  return normalized === projectNodeModules || normalized.startsWith(`${projectNodeModules}\\`);
};
const quoteShellArg = (value) => `"${String(value).replace(/"/g, '\\"')}"`;

const run = (command, args) => {
  const useCmdShell = process.platform === 'win32' && command.endsWith('.cmd');
  const result = spawnSync(useCmdShell ? [command, ...args].map(quoteShellArg).join(' ') : command, useCmdShell ? [] : args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: useCmdShell,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
};

const findNpmCommand = () => {
  if (process.platform !== 'win32') {
    return { command: 'npm', argsPrefix: [] };
  }

  const candidates = [];
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && existsSync(npmExecPath) && !isUnderProjectNodeModules(npmExecPath)) {
    candidates.push({ command: process.execPath, argsPrefix: [npmExecPath] });
  }

  const where = spawnSync('where.exe', ['npm.cmd'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  if (where.status === 0) {
    for (const candidate of where.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)) {
      if (!isUnderProjectNodeModules(candidate)) {
        candidates.push({ command: candidate, argsPrefix: [] });
      }
    }
  }

  return candidates[0] ?? { command: executable('npm'), argsPrefix: [] };
};

const resolvePackageRoot = () => {
  try {
    return dirname(require.resolve(`${packageName}/package.json`));
  } catch {
    return null;
  }
};

const readJson = (filePath) => JSON.parse(readFileSync(filePath, 'utf8'));

const readMarker = () => {
  if (!existsSync(markerPath)) {
    return null;
  }

  try {
    return readJson(markerPath);
  } catch {
    return null;
  }
};

const getPackageVersion = (packageRoot) => readJson(join(packageRoot, 'package.json')).version;

const getPrebuildStats = (packageRoot) => {
  const prebuildRoot = join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`);
  const files = {};

  for (const name of prebuildNames) {
    const filePath = join(prebuildRoot, name);
    if (!existsSync(filePath)) {
      return null;
    }

    const stats = statSync(filePath);
    files[name] = {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    };
  }

  return files;
};

const getCurrentState = (packageRoot) => {
  const files = getPrebuildStats(packageRoot);
  if (!files) {
    return null;
  }

  return {
    packageName,
    packageVersion: getPackageVersion(packageRoot),
    platform: process.platform,
    arch: process.arch,
    buildScriptMtime: existsSync(buildScriptPath) ? statSync(buildScriptPath).mtimeMs : 0,
    ensureScriptMtime: statSync(ensureScriptPath).mtimeMs,
    files,
  };
};

const isCurrent = (marker, state) =>
  Boolean(
    marker &&
      state &&
      marker.packageName === state.packageName &&
      marker.packageVersion === state.packageVersion &&
      marker.platform === state.platform &&
      marker.arch === state.arch &&
      marker.buildScriptMtime === state.buildScriptMtime &&
      marker.ensureScriptMtime === state.ensureScriptMtime &&
      JSON.stringify(marker.files) === JSON.stringify(state.files),
  );

const writeMarker = (state) => {
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
};

const canRequireRaop = () => {
  const result = spawnSync(process.execPath, [
    '-e',
    [
      `const raop = require(${JSON.stringify(packageName)});`,
      "if (typeof raop.startReceiver !== 'function' || typeof raop.stopReceiver !== 'function') process.exit(1);",
      "if (typeof raop.startAlacDecoder !== 'function' || typeof raop.decodeAlacFrame !== 'function' || typeof raop.stopAlacDecoder !== 'function') process.exit(1);",
      "const handle = raop.startAlacDecoder({ sampleRate: 44100, sampleSize: 16, channels: 2, framesPerPacket: 352 });",
      "raop.stopAlacDecoder(handle);",
    ].join(' '),
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  return result.status === 0;
};

const hasPackagedPrebuild = (packageRoot) => {
  return Boolean(getPrebuildStats(packageRoot));
};

const ensureOptionalPackageInstalled = () => {
  if (resolvePackageRoot()) {
    return;
  }

  console.log(`[ensure:airplay-raop] Installing optional dependency ${packageName}...`);
  const npmCommand = findNpmCommand();
  run(npmCommand.command, [
    ...npmCommand.argsPrefix,
    'install',
    '--include=optional',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ]);
};

try {
  if (process.env.ECHO_SKIP_AIRPLAY_RAOP === '1') {
    console.log('[ensure:airplay-raop] skipped because ECHO_SKIP_AIRPLAY_RAOP=1');
    process.exit(0);
  }

  if (process.platform !== 'win32') {
    console.log(`[ensure:airplay-raop] skipped on ${process.platform}; Windows RAOP build script is not supported here.`);
    process.exit(0);
  }

  ensureOptionalPackageInstalled();
  const packageRoot = resolvePackageRoot();
  if (!packageRoot) {
    throw new Error(`${packageName} is still missing after npm install.`);
  }

  const currentState = getCurrentState(packageRoot);
  if (isCurrent(readMarker(), currentState)) {
    console.log('[ensure:airplay-raop] RAOP native backend already verified; skipping probe.');
    process.exit(0);
  }

  if (canRequireRaop() && hasPackagedPrebuild(packageRoot)) {
    writeMarker(getCurrentState(packageRoot));
    console.log('[ensure:airplay-raop] RAOP native backend is ready.');
    process.exit(0);
  }

  console.log('[ensure:airplay-raop] Building RAOP native backend...');
  run(process.execPath, [join(projectRoot, 'scripts', 'build-airplay-raop.mjs')]);

  if (!canRequireRaop() || !hasPackagedPrebuild(packageRoot)) {
    throw new Error('RAOP native backend did not pass verification after build.');
  }

  writeMarker(getCurrentState(packageRoot));
  console.log('[ensure:airplay-raop] RAOP native backend is ready.');
} catch (error) {
  console.error(`[ensure:airplay-raop] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
