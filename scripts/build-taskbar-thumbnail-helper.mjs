import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

// Builds the in-process DWM iconic-bitmap addon (echo-taskbar-thumbnail-helper.node)
// that renders the album cover into the Windows taskbar hover thumbnail.
// Mirrors scripts/build-smtc-host.mjs, but produces a Node-API .node addon via
// cmake-js instead of a standalone .exe.

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const sourceDir = join(projectRoot, 'native', 'taskbar-thumbnail-helper');
const buildDir = join(projectRoot, 'out', 'native', 'taskbar-thumbnail-helper');
const targetDir = join(projectRoot, 'electron-app', 'build');
const targetNode = join(targetDir, 'echo-taskbar-thumbnail-helper.node');
const packagedResource = join(
  projectRoot,
  'dist',
  'win-unpacked',
  'resources',
  'echo-taskbar-thumbnail-helper.node',
);
const config = process.env.ECHO_TASKBAR_HELPER_CONFIG || 'Release';

// N-API is ABI-stable, so a single build works across Electron/Node versions.
// We still build against the addon-api headers resolved from the project root.
const require = createRequire(import.meta.url);
const addonApiInclude = dirname(require.resolve('node-addon-api/napi.h'));

// Run cmake-js via its JS entry with the current node binary. Spawning the
// .cmd shim with shell:false throws EINVAL on modern Windows, so we avoid it.
const cmakeJsEntry = require.resolve('cmake-js/bin/cmake-js');

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

const copyBuiltAddon = (source, destination) => {
  // The .node addon may be loaded by a running Electron dev instance; copying
  // over a locked file fails, so retry a few times.
  let lastError = null;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
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

const findBuiltAddon = () => {
  const candidates = [
    join(buildDir, config, 'echo-taskbar-thumbnail-helper.node'),
    join(buildDir, 'echo-taskbar-thumbnail-helper.node'),
    join(buildDir, 'Release', 'echo-taskbar-thumbnail-helper.node'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
};

try {
  if (process.platform !== 'win32') {
    console.log('[build:taskbar-helper] Skipping Windows-only taskbar thumbnail helper build.');
    process.exit(0);
  }

  // cmake-js configures + builds the addon, wiring node headers, the import lib
  // and the Windows delay-load hook. We pass our addon-api include dir through
  // to CMake as NODE_ADDON_API_INC.
  run(process.execPath, [
    cmakeJsEntry,
    'compile',
    '--directory',
    sourceDir,
    '--out',
    buildDir,
    '--config',
    config,
    '--CDNODE_ADDON_API_INC=' + addonApiInclude,
  ]);

  const builtAddon = findBuiltAddon();
  if (!builtAddon) {
    throw new Error(`Built taskbar thumbnail helper addon was not found under ${buildDir}`);
  }

  mkdirSync(targetDir, { recursive: true });
  copyBuiltAddon(builtAddon, targetNode);
  console.log(`[build:taskbar-helper] Copied ${builtAddon}`);
  console.log(`[build:taskbar-helper]      -> ${targetNode}`);

  if (existsSync(dirname(packagedResource))) {
    copyBuiltAddon(builtAddon, packagedResource);
    console.log(`[build:taskbar-helper]      -> ${packagedResource}`);
  }
} catch (error) {
  console.error('[build:taskbar-helper] Failed to build Windows taskbar thumbnail helper.');
  console.error('[build:taskbar-helper] Requirements: CMake, Visual Studio 2022 Build Tools, and Windows SDK 10.0.19041 or newer.');
  console.error(`[build:taskbar-helper] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
