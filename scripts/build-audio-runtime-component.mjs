import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
const componentId = 'audio-win-x64';
const outputPath = join(projectRoot, 'dist', `ECHO-NEXT-Audio-Windows-x64-${packageJson.version}.echo-component`);
const sources = [
  ['echo-audio-host.exe', 'electron-app/build/echo-audio-host.exe'],
  ['avcodec-62.dll', 'electron-app/build/avcodec-62.dll'],
  ['avformat-62.dll', 'electron-app/build/avformat-62.dll'],
  ['avutil-60.dll', 'electron-app/build/avutil-60.dll'],
  ['swresample-6.dll', 'electron-app/build/swresample-6.dll'],
  ['tools/ffmpeg.exe', 'electron-app/tools/ffmpeg.exe'],
  ['tools/ffmpeg-manifest.json', 'electron-app/tools/ffmpeg-manifest.json'],
];

const entries = {};
const files = sources.map(([archivePath, sourcePath]) => {
  const absolutePath = join(projectRoot, sourcePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing audio component input: ${absolutePath}`);
  }
  const bytes = readFileSync(absolutePath);
  entries[archivePath] = bytes;
  return {
    path: archivePath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength,
  };
});

const manifest = {
  schemaVersion: 1,
  componentId,
  version: String(packageJson.version),
  platform: 'win32',
  arch: 'x64',
  generatedAt: new Date().toISOString(),
  files,
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
entries['echo-component.json'] = manifestBytes;
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, zipSync(entries, { level: 6 }));
console.log(`[audio-component] wrote ${basename(outputPath)} (${(statSync(outputPath).size / 1024 / 1024).toFixed(1)} MiB)`);
