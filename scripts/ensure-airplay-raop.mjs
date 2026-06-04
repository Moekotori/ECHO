import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const require = createRequire(import.meta.url);
const packageName = '@lox-audioserver/node-libraop';

const executable = (name) => (process.platform === 'win32' ? `${name}.cmd` : name);

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

const resolvePackageRoot = () => {
  try {
    return dirname(require.resolve(`${packageName}/package.json`));
  } catch {
    return null;
  }
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
  const prebuildRoot = join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`);
  return [
    'raop_addon.node.napi.node',
    'libssl-3-x64.dll',
    'libcrypto-3-x64.dll',
    'pthreadVC3.dll',
  ].every((name) => existsSync(join(prebuildRoot, name)));
};

const ensureOptionalPackageInstalled = () => {
  if (resolvePackageRoot()) {
    return;
  }

  console.log(`[ensure:airplay-raop] Installing optional dependency ${packageName}...`);
  run(executable('npm'), ['install', '--include=optional', '--ignore-scripts', '--no-audit', '--no-fund']);
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

  if (canRequireRaop() && hasPackagedPrebuild(packageRoot)) {
    console.log('[ensure:airplay-raop] RAOP native backend is ready.');
    process.exit(0);
  }

  console.log('[ensure:airplay-raop] Building RAOP native backend...');
  run(process.execPath, [join(projectRoot, 'scripts', 'build-airplay-raop.mjs')]);

  if (!canRequireRaop() || !hasPackagedPrebuild(packageRoot)) {
    throw new Error('RAOP native backend did not pass verification after build.');
  }

  console.log('[ensure:airplay-raop] RAOP native backend is ready.');
} catch (error) {
  console.error(`[ensure:airplay-raop] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
