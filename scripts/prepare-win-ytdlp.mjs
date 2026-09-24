import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(projectRoot, 'electron-app', 'tools', 'yt-dlp-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const target = resolve(projectRoot, String(manifest.artifact ?? ''));
const expectedHash = String(manifest.sha256 ?? '').toUpperCase();

const fail = (message) => {
  console.error(`[prepare:win-ytdlp] ${message}`);
  process.exit(1);
};

if (process.platform !== 'win32') {
  fail(`This script prepares Windows yt-dlp and must run on Windows. Current platform is ${process.platform}/${process.arch}.`);
}
if (!/^https:\/\/github\.com\/yt-dlp\/yt-dlp\/releases\/download\/[\w.-]+\/yt-dlp\.exe$/u.test(String(manifest.sourceUrl ?? ''))) {
  fail('Manifest sourceUrl must be the pinned official yt-dlp release URL.');
}
if (!/^[A-F0-9]{64}$/u.test(expectedHash)) {
  fail(`Manifest SHA256 is not configured for ${target}`);
}

const hashFile = (filePath) => createHash('sha256').update(readFileSync(filePath)).digest('hex').toUpperCase();
const verify = () => {
  if (!existsSync(target) || !statSync(target).isFile()) {
    return false;
  }
  const actualHash = hashFile(target);
  if (actualHash !== expectedHash) {
    return false;
  }
  const version = execFileSync(target, ['--version'], { encoding: 'utf8', timeout: 15_000, windowsHide: true }).trim();
  if (version !== String(manifest.version ?? '')) {
    fail(`Version mismatch for ${target}; expected ${manifest.version}, got ${version || 'empty'}`);
  }
  console.log(`[prepare:win-ytdlp] OK ${target} version=${version} sha256=${actualHash}`);
  return true;
};

if (verify()) {
  process.exit(0);
}

const cacheDir = process.env.ECHO_YTDLP_CACHE_DIR
  ? resolve(projectRoot, process.env.ECHO_YTDLP_CACHE_DIR)
  : join(projectRoot, '.electron-cache', 'yt-dlp');
const cached = join(cacheDir, `yt-dlp-${manifest.version}.exe`);
const downloadAttempts = 3;
const retryDelayMs = 1_500;
const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const formatError = (error) => {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `${error.message}${cause}`;
};
const download = async (url, destination) => {
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  let lastError = null;
  for (let attempt = 1; attempt <= downloadAttempts; attempt += 1) {
    rmSync(temporary, { force: true });
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'ECHODev-build-prep' } });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
      renameSync(temporary, destination);
      return;
    } catch (error) {
      lastError = error;
      rmSync(temporary, { force: true });
      if (attempt < downloadAttempts) {
        console.warn(
          `[prepare:win-ytdlp] download attempt ${attempt}/${downloadAttempts} failed: ${formatError(error)}; retrying`,
        );
        await sleep(retryDelayMs * attempt);
      }
    }
  }
  fail(`Download failed for ${url} after ${downloadAttempts} attempts: ${formatError(lastError)}`);
};

if (!existsSync(cached) || hashFile(cached) !== expectedHash) {
  console.log(`[prepare:win-ytdlp] downloading ${manifest.sourceUrl}`);
  await download(manifest.sourceUrl, cached);
}
if (hashFile(cached) !== expectedHash) {
  fail(`SHA256 mismatch for cached yt-dlp; expected ${expectedHash}, got ${hashFile(cached)}`);
}

mkdirSync(dirname(target), { recursive: true });
const temporaryTarget = `${target}.tmp-${process.pid}`;
rmSync(temporaryTarget, { force: true });
await copyFile(cached, temporaryTarget);
renameSync(temporaryTarget, target);
if (!verify()) {
  fail(`Prepared yt-dlp failed verification: ${target}`);
}
