import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolsDir = join(projectRoot, 'electron-app', 'tools-linux');
const targetFfmpeg = join(toolsDir, 'ffmpeg');
const manifestPath = join(toolsDir, 'ffmpeg-manifest.json');

const fail = (message) => {
  console.error(`[prepare:linux-ffmpeg] ${message}`);
  process.exit(1);
};

const run = (command, args) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  });

const findFfmpeg = () => {
  const explicitPath = process.env.ECHO_LINUX_FFMPEG_SOURCE?.trim();
  if (explicitPath) {
    return resolve(projectRoot, explicitPath);
  }

  try {
    const fromPath = run('bash', ['-lc', 'command -v ffmpeg']).trim();
    return fromPath || null;
  } catch {
    return null;
  }
};

if (process.platform !== 'linux') {
  fail(`This script prepares Linux ffmpeg and must run on Linux. Current platform is ${process.platform}/${process.arch}.`);
}

if (process.arch !== 'x64') {
  fail(`Linux ffmpeg preparation currently supports x64 only. Current architecture is ${process.arch}.`);
}

const sourceFfmpeg = findFfmpeg();
if (!sourceFfmpeg || !existsSync(sourceFfmpeg)) {
  fail('Missing ffmpeg. Install ffmpeg or set ECHO_LINUX_FFMPEG_SOURCE to a Linux x64 ffmpeg binary.');
}

const sourceStats = statSync(sourceFfmpeg);
if (!sourceStats.isFile()) {
  fail(`FFmpeg source is not a file: ${sourceFfmpeg}`);
}

mkdirSync(toolsDir, { recursive: true });
copyFileSync(sourceFfmpeg, targetFfmpeg);
chmodSync(targetFfmpeg, 0o755);

const versionOutput = run(targetFfmpeg, ['-hide_banner', '-version']);
const firstVersionLine = versionOutput.split(/\r?\n/u).find(Boolean) ?? '';
const hash = createHash('sha256').update(readFileSync(targetFfmpeg)).digest('hex').toUpperCase();

const manifest = {
  name: 'ffmpeg',
  version: firstVersionLine,
  source: process.env.ECHO_LINUX_FFMPEG_SOURCE ? 'Linux x64 ffmpeg supplied by ECHO_LINUX_FFMPEG_SOURCE' : 'Linux x64 ffmpeg from build runner PATH',
  sourceUrl: process.env.ECHO_LINUX_FFMPEG_SOURCE_URL ?? '',
  downloadPage: 'https://ffmpeg.org/download.html',
  artifact: 'electron-app/tools-linux/ffmpeg',
  sha256: hash,
  requiresSoxr: true,
  requiredFilters: ['aresample'],
  licenseFamily: 'GPLv3',
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`[prepare:linux-ffmpeg] Prepared ${targetFfmpeg}`);
console.log(`[prepare:linux-ffmpeg] ${firstVersionLine}`);
console.log(`[prepare:linux-ffmpeg] sha256=${hash}`);
