import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const hostBinary = join(projectRoot, 'electron-app', 'build', 'echo-audio-host');
const nativeScannerBinary = join(projectRoot, 'electron-app', 'build', 'echo-native-scanner');
const packagedHostBinary = join(projectRoot, 'dist', 'linux-unpacked', 'resources', 'echo-audio-host');
const packagedNativeScannerBinary = join(projectRoot, 'dist', 'linux-unpacked', 'resources', 'echo-native-scanner');
const linuxToolsDir = join(projectRoot, 'electron-app', 'tools-linux');
const linuxFfmpegBinary = join(linuxToolsDir, 'ffmpeg');
const linuxYtDlpBinary = join(linuxToolsDir, 'yt-dlp');
const packagedFfmpegBinary = join(projectRoot, 'dist', 'linux-unpacked', 'resources', 'tools', 'ffmpeg');
const packagedYtDlpBinary = join(projectRoot, 'dist', 'linux-unpacked', 'resources', 'tools', 'yt-dlp');
const distDir = join(projectRoot, 'dist');
const electronBuilderBin = join(projectRoot, 'node_modules', '.bin', 'electron-builder');

const fail = (message) => {
  console.error(`[build:linux] ${message}`);
  process.exit(1);
};

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
};

const assertExecutableFile = (filePath, label) => {
  if (!existsSync(filePath)) {
    fail(`Missing ${label}: ${filePath}`);
  }

  const stats = statSync(filePath);
  if (!stats.isFile()) {
    fail(`${label} is not a file: ${filePath}`);
  }

  if ((stats.mode & 0o111) === 0) {
    fail(`${label} is not executable: ${filePath}`);
  }
};

const assertLinuxArtifacts = () => {
  if (!existsSync(distDir)) {
    fail(`Missing dist directory: ${distDir}`);
  }

  const files = readdirSync(distDir);
  const appImage = files.find((name) => name.endsWith('.AppImage'));
  const deb = files.find((name) => name.endsWith('.deb'));

  if (!appImage) {
    fail('Linux AppImage artifact was not created under dist/.');
  }

  if (!deb) {
    fail('Linux deb artifact was not created under dist/.');
  }

  console.log(`[build:linux] Verified AppImage: ${appImage}`);
  console.log(`[build:linux] Verified deb: ${deb}`);
};

try {
  if (process.platform !== 'linux') {
    fail(
      `Linux packages must be built on Linux x64. Current platform is ${process.platform}/${process.arch}; use WSL, a Linux VM, or a Linux CI runner.`,
    );
  }

  if (process.arch !== 'x64') {
    fail(`Linux packaging currently supports x64 only. Current architecture is ${process.arch}.`);
  }

  assertExecutableFile(linuxFfmpegBinary, 'Linux ffmpeg');
  run('npm', ['run', 'rebuild:native']);
  run('npm', ['run', 'verify:ffmpeg']);
  run('npm', ['run', 'build:audio-host']);
  run('npm', ['run', 'build:native-scanner']);
  assertExecutableFile(hostBinary, 'Linux audio host');
  assertExecutableFile(nativeScannerBinary, 'Linux native scanner');

  run('npm', ['run', 'build']);
  run(electronBuilderBin, ['--linux']);

  assertExecutableFile(packagedHostBinary, 'packaged Linux audio host');
  assertExecutableFile(packagedNativeScannerBinary, 'packaged Linux native scanner');
  assertExecutableFile(packagedFfmpegBinary, 'packaged Linux ffmpeg');
  if (existsSync(linuxYtDlpBinary)) {
    assertExecutableFile(packagedYtDlpBinary, 'packaged Linux yt-dlp');
  }
  assertLinuxArtifacts();

  console.log('[build:linux] Linux build completed.');
} catch (error) {
  console.error('[build:linux] Failed.');
  console.error(`[build:linux] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
