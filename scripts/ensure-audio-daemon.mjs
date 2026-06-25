import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const sourceDir = join(projectRoot, 'native', 'echo-audio-daemon', 'src');
const targetExe = join(projectRoot, 'electron-app', 'build',
  process.platform === 'win32' ? 'echo-audio-daemon.exe' : 'echo-audio-daemon');
const buildScript = join(projectRoot, 'scripts', 'build-audio-daemon.mjs');

const getLatestMtime = (dir) => {
  let latest = 0;
  if (!existsSync(dir)) return latest;
  for (const name of readdirSync(dir, { recursive: true })) {
    const p = join(dir, name);
    try { if (statSync(p).isFile()) latest = Math.max(latest, statSync(p).mtimeMs); } catch {}
  }
  return latest;
};

try {
  if (process.env.ECHO_SKIP_AUDIO_DAEMON_BUILD === '1') {
    console.log('[ensure:audio-daemon] Skipped (ECHO_SKIP_AUDIO_DAEMON_BUILD=1)');
    process.exit(0);
  }

  const targetMtime = existsSync(targetExe) ? statSync(targetExe).mtimeMs : 0;
  const latestSourceMtime = getLatestMtime(sourceDir);

  if (targetMtime > 0 && targetMtime >= latestSourceMtime) {
    console.log(`[ensure:audio-daemon] ${targetExe} is up to date.`);
    process.exit(0);
  }

  console.log('[ensure:audio-daemon] Building daemon...');
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, [buildScript], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
} catch (error) {
  console.error('[ensure:audio-daemon]', error.message);
  process.exit(1);
}
