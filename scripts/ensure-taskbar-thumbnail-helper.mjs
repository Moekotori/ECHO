import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Builds the taskbar thumbnail helper addon only when it is missing, so `dev`
// does not pay the CMake cost on every start. N-API keeps the addon ABI-stable
// across Electron upgrades, so presence is a sufficient check.

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const targetNode = join(projectRoot, 'electron-app', 'build', 'echo-taskbar-thumbnail-helper.node');

if (process.platform !== 'win32') {
  process.exit(0);
}

if (existsSync(targetNode)) {
  console.log('[ensure:taskbar-helper] Addon already present; skipping build.');
  process.exit(0);
}

const result = spawnSync(process.execPath, [join(projectRoot, 'scripts', 'build-taskbar-thumbnail-helper.mjs')], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: false,
});

// Do not fail dev startup if the optional native helper cannot be built; the
// TypeScript integration falls back to setThumbnailClip when the addon is absent.
if (result.status !== 0) {
  console.warn('[ensure:taskbar-helper] Build failed; taskbar cover thumbnail will be disabled.');
}

process.exit(0);
