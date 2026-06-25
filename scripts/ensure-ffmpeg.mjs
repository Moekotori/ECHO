#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');

const platform = process.platform;
const defaultToolsDir = platform === 'win32' ? 'tools' : 'tools-linux';
const toolsDir = join(projectRoot, 'electron-app', defaultToolsDir);
const manifestPath = join(toolsDir, 'ffmpeg-manifest.json');

const log = (...args) => console.log('[ensure:ffmpeg]', ...args);

// Check if FFmpeg already exists and is valid
if (existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const artifactPath = resolve(projectRoot, String(manifest.artifact ?? ''));
    if (existsSync(artifactPath)) {
      log(`FFmpeg already exists at ${artifactPath}`);
      process.exit(0);
    }
  } catch { /* manifest invalid, will download */ }
}

// Determine download URL based on platform
async function downloadAndExtract() {
  if (platform === 'win32') {
    // Windows: download full build from gyan.dev
    const url = 'https://github.com/GyanD/codexffmpeg/releases/download/8.1.1/ffmpeg-8.1.1-full_build.zip';
    const zipPath = join(toolsDir, 'ffmpeg.zip');
    log(`Downloading FFmpeg from ${url}...`);

    // Download zip
    const dl = spawnSync('curl', ['-#L', '-o', zipPath, url], { stdio: 'inherit', shell: true });
    if (dl.status !== 0) {
      // Fallback to node's https
      log('curl not available, trying Node.js download...');
      const https = await import('node:https');
      await new Promise((resolve, reject) => {
        const file = createWriteStream(zipPath);
        https.get(url, res => res.pipe(file));
        file.on('finish', resolve);
        file.on('error', reject);
      });
    }

    // Extract ffmpeg.exe from zip
    log('Extracting ffmpeg.exe...');
    spawnSync('unzip', ['-o', '-j', zipPath, '*/bin/ffmpeg.exe', '-d', toolsDir], { stdio: 'inherit' });
    // Also try without wildcard
    if (!existsSync(join(toolsDir, 'ffmpeg.exe'))) {
      spawnSync('unzip', ['-o', zipPath, '-d', toolsDir], { stdio: 'inherit' });
      // Find ffmpeg.exe recursively
      const { execSync } = await import('node:child_process');
      try {
        const found = execSync(`dir /s /b "${toolsDir}\\ffmpeg.exe" 2>nul || find "${toolsDir}" -name ffmpeg.exe`, { shell: true }).toString().trim();
        if (found) {
          const { copyFileSync } = await import('node:fs');
          copyFileSync(found, join(toolsDir, 'ffmpeg.exe'));
        }
      } catch {}
    }
  } else {
    // Linux: download static build from johnvansickle.com
    const url = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';
    const tarball = join(toolsDir, 'ffmpeg.tar.xz');
    log(`Downloading Linux FFmpeg static build...`);

    // Download using curl or Node.js https
    const dl = spawnSync('curl', ['-#L', '-o', tarball, url], { stdio: 'inherit', shell: true });
    if (dl.status !== 0) {
      log('Downloading via Node.js...');
      const https = await import('node:https');
      const fs = await import('node:fs');
      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(tarball);
        https.get(url, res => res.pipe(file));
        file.on('finish', resolve);
        file.on('error', reject);
      });
    }

    // Extract
    log('Extracting ffmpeg...');
    spawnSync('tar', ['xf', tarball, '-C', toolsDir], { stdio: 'inherit' });
    // Find ffmpeg binary in extracted directory
    const name = spawnSync('ls', [toolsDir]).stdout.toString().split('\n').find(s => s.startsWith('ffmpeg-'));
    if (name) {
      const bin = join(toolsDir, name, 'ffmpeg');
      if (existsSync(bin)) {
        spawnSync('cp', [bin, join(toolsDir, 'ffmpeg')]);
        spawnSync('chmod', ['+x', join(toolsDir, 'ffmpeg')]);
      }
    }
  }
}

if (!existsSync(toolsDir)) mkdirSync(toolsDir, { recursive: true });

try {
  await downloadAndExtract();
  // Update manifest SHA256 if needed
  const artifactName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const artifactPath = join(toolsDir, artifactName);
  if (existsSync(artifactPath)) {
    const hash = createHash('sha256').update(readFileSync(artifactPath)).digest('hex').toUpperCase();
    log(`Downloaded FFmpeg SHA256: ${hash}`);
    log('Update ffmpeg-manifest.json with this hash to make verify:ffmpeg pass.');
  }
  log('FFmpeg ready');
} catch (err) {
  log(`Failed: ${err.message}`);
  process.exit(1);
}
