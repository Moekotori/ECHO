import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultToolsDirectory = process.platform === 'win32' ? 'tools' : 'tools-linux';
const manifestPath = process.env.ECHO_FFMPEG_MANIFEST
  ? resolve(projectRoot, process.env.ECHO_FFMPEG_MANIFEST)
  : join(projectRoot, 'electron-app', defaultToolsDirectory, 'ffmpeg-manifest.json');

const fail = (message) => {
  console.error(`[verify:ffmpeg] ${message}`);
  process.exit(1);
};

if (!existsSync(manifestPath)) {
  fail(`Missing manifest at ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const artifactPath = resolve(projectRoot, String(manifest.artifact ?? ''));

if (!existsSync(artifactPath)) {
  fail(`Missing ffmpeg binary at ${artifactPath}`);
}

const artifactStats = statSync(artifactPath);
if (!artifactStats.isFile()) {
  fail(`FFmpeg artifact is not a file: ${artifactPath}`);
}

if (process.platform !== 'win32' && (artifactStats.mode & 0o111) === 0) {
  fail(`FFmpeg artifact is not executable: ${artifactPath}`);
}

const hash = createHash('sha256').update(readFileSync(artifactPath)).digest('hex').toUpperCase();
const expectedHash = String(manifest.sha256 ?? '').toUpperCase();
if (!/^[A-F0-9]{64}$/u.test(expectedHash)) {
  fail(`Manifest SHA256 is not configured for ${artifactPath}`);
}
if (hash !== expectedHash) {
  fail(`SHA256 mismatch for ${artifactPath}; expected ${expectedHash || 'n/a'}, got ${hash}`);
}

const ffmpegProbeTimeoutMs = 30000;
const versionOutput = execFileSync(artifactPath, ['-hide_banner', '-version'], {
  encoding: 'utf8',
  timeout: ffmpegProbeTimeoutMs,
  windowsHide: true,
});
const version = String(manifest.version ?? '');
if (version && !versionOutput.includes(version)) {
  fail(`Version output does not contain "${version}"`);
}

if (manifest.requiresSoxr === true && !versionOutput.includes('--enable-libsoxr')) {
  fail('FFmpeg build configuration does not include --enable-libsoxr');
}

const filtersOutput = execFileSync(artifactPath, ['-hide_banner', '-filters'], {
  encoding: 'utf8',
  timeout: ffmpegProbeTimeoutMs,
  windowsHide: true,
});
const requiredFilters = Array.isArray(manifest.requiredFilters) ? manifest.requiredFilters : [];
for (const filter of requiredFilters) {
  const pattern = new RegExp(`(^|\\n)\\s*\\.{2,3}\\s+${String(filter).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'u');
  if (!pattern.test(filtersOutput)) {
    fail(`Required FFmpeg filter is missing: ${filter}`);
  }
}

console.log(`[verify:ffmpeg] OK ${version || artifactPath} sha256=${hash}`);
