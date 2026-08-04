import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const target = process.argv[2] ?? 'electron';
const betterSqlitePackageJsonPath = join(projectRoot, 'node_modules', 'better-sqlite3', 'package.json');
const betterSqliteModuleRoot = join(projectRoot, 'node_modules', 'better-sqlite3');
const nativeBinaryPath = join(projectRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
const markerPath = join(projectRoot, 'node_modules', '.echo-native-abi.json');
const cacheRoot = join(projectRoot, 'node_modules', '.echo-native-cache', 'better-sqlite3');
const betterSqlitePatchScript = join(projectRoot, 'scripts', 'patch-better-sqlite3-electron42.cjs');
const electronVerifyScriptPath = join(projectRoot, 'node_modules', `.echo-native-abi-electron-verify-${process.pid}.cjs`);

if (process.env.ECHO_SKIP_NATIVE_ABI === '1') {
  console.log(`[native-abi] skipped ${target} ABI alignment because ECHO_SKIP_NATIVE_ABI=1`);
  process.exit(0);
}

const executable = (name) => (process.platform === 'win32' ? `${name}.cmd` : name);
const quoteShellArg = (value) => `"${String(value).replace(/"/g, '\\"')}"`;

const run = (command, args, options = {}) => {
  const useCmdShell = process.platform === 'win32' && command.endsWith('.cmd');
  const result = spawnSync(useCmdShell ? [command, ...args].map(quoteShellArg).join(' ') : command, useCmdShell ? [] : args, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: useCmdShell,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}${output ? `\n${output}` : ''}`);
  }

  return typeof result.stdout === 'string' ? result.stdout.trim() : '';
};

const findNpmCli = () => {
  const npmCliPath = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return existsSync(npmCliPath) ? npmCliPath : null;
};

const readJson = (filePath) => JSON.parse(readFileSync(filePath, 'utf8'));
const getBetterSqliteVersion = () => readJson(betterSqlitePackageJsonPath).version;
const sanitizeCachePart = (value) => String(value).replace(/[^a-zA-Z0-9._-]/g, '_');

const getCachePath = (info) =>
  join(
    cacheRoot,
    `${sanitizeCachePart(process.platform)}-${sanitizeCachePart(process.arch)}`,
    [
      `better-sqlite3-${sanitizeCachePart(getBetterSqliteVersion())}`,
      sanitizeCachePart(info.runtime),
      sanitizeCachePart(info.runtimeVersion),
      `abi${sanitizeCachePart(info.abi)}`,
    ].join('-') + '.node',
  );

const getElectronAbi = async (electronVersion) => {
  try {
    const { getAbi } = await import('node-abi');
    return getAbi(electronVersion, 'electron');
  } catch {
    return run(join(projectRoot, 'node_modules', '.bin', executable('electron')), ['--abi']);
  }
};

const getTargetInfo = async () => {
  if (target === 'electron') {
    const electronPackageJson = readJson(join(projectRoot, 'node_modules', 'electron', 'package.json'));

    return {
      runtime: 'electron',
      abi: await getElectronAbi(electronPackageJson.version),
      runtimeVersion: electronPackageJson.version,
    };
  }

  if (target === 'node') {
    return {
      runtime: 'node',
      abi: process.versions.modules,
      runtimeVersion: process.version,
    };
  }

  throw new Error(`Unknown native ABI target "${target}". Expected "electron" or "node".`);
};

const getNativeStats = () => {
  if (!existsSync(nativeBinaryPath)) {
    return null;
  }

  const stats = statSync(nativeBinaryPath);

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
    return readJson(markerPath);
  } catch {
    return null;
  }
};

const writeMarker = (info) => {
  const nativeStats = getNativeStats();

  if (!nativeStats) {
    throw new Error(`Native binary was not found after rebuild: ${nativeBinaryPath}`);
  }

  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(
    markerPath,
    `${JSON.stringify(
      {
        ...info,
        betterSqlite3Version: getBetterSqliteVersion(),
        nativeBinary: nativeStats,
      },
      null,
      2,
    )}\n`,
  );
};

const isCurrent = (marker, info) => {
  const nativeStats = getNativeStats();

  return Boolean(
    marker &&
      nativeStats &&
      marker.runtime === info.runtime &&
      marker.abi === info.abi &&
      marker.betterSqlite3Version === getBetterSqliteVersion() &&
      marker.nativeBinary?.size === nativeStats.size &&
      marker.nativeBinary?.mtimeMs === nativeStats.mtimeMs,
  );
};

const verifyNativeBinary = (info) => {
  try {
    if (info.runtime === 'electron') {
      writeFileSync(
        electronVerifyScriptPath,
        [
          "const { app } = require('electron');",
          'try {',
          '  const Database = require(process.argv[2]);',
          "  const db = new Database(':memory:');",
          "  db.exec('select 1');",
          '  db.close();',
          '  app.exit(0);',
          '} catch (error) {',
          '  console.error(error && error.stack ? error.stack : String(error));',
          '  app.exit(1);',
          '}',
          '',
        ].join('\n'),
        'utf8',
      );
      run(join(projectRoot, 'node_modules', '.bin', executable('electron')), [electronVerifyScriptPath, betterSqliteModuleRoot]);
      return true;
    }

    run(process.execPath, [
      '-e',
      [
        "const Database = require('better-sqlite3');",
        "const db = new Database(':memory:');",
        "db.exec('select 1');",
        'db.close();',
      ].join(''),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(electronVerifyScriptPath, { force: true });
  }
};

const copyFileWithRetry = (sourcePath, targetPath) => {
  const maxAttempts = process.platform === 'win32' ? 8 : 1;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      copyFileSync(sourcePath, targetPath);
      return;
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts) {
        break;
      }

      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250 * attempt);
    }
  }

  throw lastError;
};

const cacheNativeBinary = (info) => {
  if (!existsSync(nativeBinaryPath)) {
    return false;
  }

  const cachePath = getCachePath(info);
  mkdirSync(dirname(cachePath), { recursive: true });
  copyFileWithRetry(nativeBinaryPath, cachePath);
  return true;
};

const restoreCachedBinary = (info) => {
  const cachePath = getCachePath(info);

  if (!existsSync(cachePath)) {
    return false;
  }

  mkdirSync(dirname(nativeBinaryPath), { recursive: true });
  copyFileWithRetry(cachePath, nativeBinaryPath);
  writeMarker(info);
  return true;
};

const rebuild = (info) => {
  if (info.runtime === 'electron') {
    run(join(projectRoot, 'node_modules', '.bin', executable('electron-rebuild')), [
      '-f',
      '-o',
      'better-sqlite3',
      '-v',
      info.runtimeVersion,
      '--build-from-source',
    ], {
      stdio: 'inherit',
      encoding: undefined,
    });
    return;
  }

  const npmCliPath = findNpmCli();

  if (npmCliPath) {
    run(process.execPath, [npmCliPath, 'rebuild', 'better-sqlite3'], {
      stdio: 'inherit',
      encoding: undefined,
    });
    return;
  }

  run(executable('npm'), ['rebuild', 'better-sqlite3'], {
    stdio: 'inherit',
    encoding: undefined,
  });
};

try {
  run(process.execPath, [betterSqlitePatchScript], {
    stdio: 'inherit',
    encoding: undefined,
  });

  const info = await getTargetInfo();
  const marker = readMarker();

  if (isCurrent(marker, info) && verifyNativeBinary(info)) {
    cacheNativeBinary(info);
    console.log(`[native-abi] better-sqlite3 already matches ${info.runtime} ABI ${info.abi}; skipping rebuild.`);
    process.exit(0);
  }

  if (marker && isCurrent(marker, marker) && verifyNativeBinary(marker)) {
    cacheNativeBinary(marker);
  }

  if (restoreCachedBinary(info) && verifyNativeBinary(info)) {
    console.log(`[native-abi] Restored cached better-sqlite3 for ${info.runtime} ABI ${info.abi}.`);
    process.exit(0);
  }

  console.log(`[native-abi] Rebuilding better-sqlite3 for ${info.runtime} ABI ${info.abi}...`);
  rebuild(info);
  if (!verifyNativeBinary(info)) {
    throw new Error(`Rebuilt better-sqlite3 could not be loaded by ${info.runtime} ABI ${info.abi}.`);
  }
  writeMarker(info);
  cacheNativeBinary(info);
  console.log(`[native-abi] better-sqlite3 now matches ${info.runtime} ABI ${info.abi}.`);
} catch (error) {
  console.error(`[native-abi] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
