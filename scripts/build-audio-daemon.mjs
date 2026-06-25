import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const sourceDir = join(projectRoot, 'native', 'echo-audio-daemon');
const targetDir = join(projectRoot, 'electron-app', 'build');
const isWindows = process.platform === 'win32';
const targetExe = join(targetDir, isWindows ? 'echo-audio-daemon.exe' : 'echo-audio-daemon');
const sourceExe = join(sourceDir, 'build', 'src', isWindows ? 'Release/echo-audio-daemon.exe' : 'echo-audio-daemon');

const run = (cmd, args, cwd) => {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} failed with exit ${result.status}`);
};

try {
  console.log('[build:audio-daemon] Configuring CMake...');
  run('cmake', [
    '-B', 'build', '-S', '.',
    `-DECHO_ENABLE_ASIO=${isWindows ? 'ON' : 'OFF'}`,
    `-DECHO_ENABLE_WASAPI_EXCLUSIVE=${isWindows ? 'ON' : 'OFF'}`,
  ], sourceDir);

  console.log('[build:audio-daemon] Building...');
  run('cmake', ['--build', 'build', '--config', 'Release'], sourceDir);

  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
  copyFileSync(sourceExe, targetExe);
  console.log(`[build:audio-daemon] Copied to ${targetExe}`);
} catch (error) {
  console.error('[build:audio-daemon] Failed:', error.message);
  process.exit(1);
}
