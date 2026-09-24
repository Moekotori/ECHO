import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const host = join(root, 'electron-app', 'build', 'echo-audio-host');
const hostLib = join(root, 'electron-app', 'build', 'macos-runtime', 'lib');
const ffmpeg = join(root, 'electron-app', 'tools-macos', 'ffmpeg');
const ffmpegLib = join(root, 'electron-app', 'tools-macos', 'lib');

const fail = (message) => {
  console.error(`[verify:macos-runtime] ${message}`);
  process.exit(1);
};

for (const path of [host, ffmpeg, hostLib, ffmpegLib]) {
  if (!existsSync(path)) fail(`missing ${path}`);
}

const run = (command, args, env = {}) => {
  const result = spawnSync(command, args, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', shell: false });
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed: ${String(result.stderr ?? '').trim()}`);
  return String(result.stdout ?? '');
};

const ffmpegVersion = run(ffmpeg, ['-hide_banner', '-version'], { DYLD_LIBRARY_PATH: ffmpegLib });
if (!/^ffmpeg version /mu.test(ffmpegVersion)) fail('ffmpeg version probe failed');

const list = run(host, ['-list'], { DYLD_LIBRARY_PATH: hostLib });
if (!list.trim()) fail('audio host returned no macOS output devices');

console.log(`[verify:macos-runtime] ffmpeg and audio host runtime OK; devices=${list.trim().split(/\r?\n/u).length}`);
