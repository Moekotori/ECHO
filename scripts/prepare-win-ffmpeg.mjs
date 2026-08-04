import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(projectRoot, 'electron-app', 'tools', 'ffmpeg-manifest.json');

const fail = (message) => {
  console.error(`[prepare:win-ffmpeg] ${message}`);
  process.exit(1);
};

if (process.platform !== 'win32') {
  fail(`This script prepares Windows ffmpeg and must run on Windows. Current platform is ${process.platform}/${process.arch}.`);
}

if (!existsSync(manifestPath)) {
  fail(`Missing manifest at ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const sourceUrl = typeof manifest.sourceUrl === 'string' ? manifest.sourceUrl.trim() : '';
const targetFfmpeg = resolve(projectRoot, String(manifest.artifact ?? ''));
const targetDir = dirname(targetFfmpeg);
const expectedHash = String(manifest.sha256 ?? '').toUpperCase();

if (!sourceUrl) {
  fail('Manifest sourceUrl is empty; cannot download Windows ffmpeg.');
}

if (!/^[A-F0-9]{64}$/u.test(expectedHash)) {
  fail(`Manifest SHA256 is not configured for ${targetFfmpeg}`);
}

const hashFileSha256 = (filePath) => createHash('sha256').update(readFileSync(filePath)).digest('hex').toUpperCase();

if (existsSync(targetFfmpeg) && statSync(targetFfmpeg).isFile()) {
  const currentHash = hashFileSha256(targetFfmpeg);
  if (currentHash === expectedHash) {
    console.log(`[prepare:win-ffmpeg] OK existing ${targetFfmpeg} sha256=${currentHash}`);
    process.exit(0);
  }

  console.warn(`[prepare:win-ffmpeg] replacing ${targetFfmpeg}; expected ${expectedHash}, got ${currentHash}`);
}

const cacheRoot = process.env.ECHO_FFMPEG_CACHE_DIR
  ? resolve(projectRoot, process.env.ECHO_FFMPEG_CACHE_DIR)
  : join(projectRoot, '.electron-cache', 'ffmpeg');
const sourceName = new URL(sourceUrl).pathname.split('/').filter(Boolean).pop() || 'ffmpeg.zip';
const zipPath = join(cacheRoot, sourceName);

const downloadFile = async (url, destination) => {
  mkdirSync(dirname(destination), { recursive: true });
  const temporaryPath = `${destination}.tmp-${process.pid}`;
  rmSync(temporaryPath, { force: true });

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'ECHODev-build-prep',
    },
  });

  if (!response.ok || !response.body) {
    fail(`Download failed for ${url}: HTTP ${response.status} ${response.statusText}`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporaryPath));
  renameSync(temporaryPath, destination);
};

const readZipEntries = async () => {
  if (!existsSync(zipPath) || statSync(zipPath).size === 0) {
    console.log(`[prepare:win-ffmpeg] downloading ${sourceUrl}`);
    await downloadFile(sourceUrl, zipPath);
  }

  try {
    return unzipSync(readFileSync(zipPath));
  } catch (error) {
    console.warn(`[prepare:win-ffmpeg] cached archive is invalid, downloading again: ${error instanceof Error ? error.message : String(error)}`);
    rmSync(zipPath, { force: true });
    await downloadFile(sourceUrl, zipPath);
    return unzipSync(readFileSync(zipPath));
  }
};

const normalizeZipPath = (path) => path.replace(/\\/gu, '/');

const findToolEntry = (entries, fileName) => {
  const lowerFileName = fileName.toLowerCase();
  const candidates = Object.entries(entries).filter(([name]) => {
    const normalized = normalizeZipPath(name).toLowerCase();
    return normalized.endsWith(`/bin/${lowerFileName}`) || normalized.split('/').pop() === lowerFileName;
  });
  return candidates.sort(([left], [right]) => left.localeCompare(right))[0] ?? null;
};

const entries = await readZipEntries();
const ffmpegEntry = findToolEntry(entries, 'ffmpeg.exe');
if (!ffmpegEntry) {
  fail(`Archive does not contain ffmpeg.exe: ${zipPath}`);
}

mkdirSync(targetDir, { recursive: true });
writeFileSync(targetFfmpeg, ffmpegEntry[1]);

const actualHash = hashFileSha256(targetFfmpeg);
if (actualHash !== expectedHash) {
  rmSync(targetFfmpeg, { force: true });
  fail(`SHA256 mismatch for ${targetFfmpeg}; expected ${expectedHash}, got ${actualHash}`);
}

const ffprobeEntry = findToolEntry(entries, 'ffprobe.exe');
if (ffprobeEntry) {
  writeFileSync(join(targetDir, 'ffprobe.exe'), ffprobeEntry[1]);
}

console.log(`[prepare:win-ffmpeg] Prepared ${targetFfmpeg} sha256=${actualHash}`);
