import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Builds the in-process DWM iconic-bitmap addon (echo-taskbar-thumbnail-helper.node)
// that renders the album cover into the Windows taskbar hover thumbnail.
// Uses node-gyp from the existing Electron native rebuild toolchain.

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const sourceDir = join(projectRoot, 'native', 'taskbar-thumbnail-helper');
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
const nodeGypCli = join(projectRoot, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');

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
    join(sourceDir, 'build', config, 'echo-taskbar-thumbnail-helper.node'),
    join(sourceDir, 'build', 'Release', 'echo-taskbar-thumbnail-helper.node'),
    join(sourceDir, 'build', 'Debug', 'echo-taskbar-thumbnail-helper.node'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
};

try {
  if (process.platform !== 'win32') {
    console.log('[build:taskbar-helper] Skipping Windows-only taskbar thumbnail helper build.');
    process.exit(0);
  }

  if (!existsSync(nodeGypCli)) {
    throw new Error(`node-gyp was not found at ${nodeGypCli}`);
  }

  run(process.execPath, [
    nodeGypCli,
    'rebuild',
    '--directory',
    sourceDir,
    config.toLowerCase() === 'debug' ? '--debug' : '--release',
  ]);

  const builtAddon = findBuiltAddon();
  if (!builtAddon) {
    throw new Error(`Built taskbar thumbnail helper addon was not found under ${join(sourceDir, 'build')}`);
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
  console.error('[build:taskbar-helper] Requirements: Visual Studio 2022 Build Tools and Windows SDK 10.0.19041 or newer.');
  console.error(`[build:taskbar-helper] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
