import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const hostPath = process.env.ECHO_AUDIO_HOST_PATH
  ? resolve(projectRoot, process.env.ECHO_AUDIO_HOST_PATH)
  : join(projectRoot, 'electron-app', 'build', process.platform === 'win32' ? 'echo-audio-host.exe' : 'echo-audio-host');
const ffmpegPath = process.env.ECHO_FFMPEG_PATH
  ? resolve(projectRoot, process.env.ECHO_FFMPEG_PATH)
  : join(projectRoot, 'electron-app', 'tools', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const daemonSmokePath = join(projectRoot, 'scripts', 'smoke-daemon-playback.mjs');
const daemonFixturePath = join(projectRoot, 'test', 'tt', '三省 - 毕竟我是一条鱼.mp3');
const daemonEvidenceDir = join(projectRoot, 'out', 'smoke-daemon');

const fail = (message) => {
  console.error(`[smoke:audio-host] ${message}`);
  process.exit(1);
};

if (!existsSync(hostPath)) {
  fail(`Missing host binary: ${hostPath}. Run "npm run build:audio-host" first.`);
}

const listResult = spawnSync(hostPath, ['-list'], {
  cwd: projectRoot,
  encoding: 'utf8',
});
if (listResult.status !== 0) {
  fail(`-list failed: ${listResult.stderr || listResult.stdout}`);
}
const devices = listResult.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
if (devices.length === 0) {
  fail('-list returned no output devices');
}
console.log(`[smoke:audio-host] listed ${devices.length} output devices`);

const createWav = ({ sampleRate = 48000, seconds = 0.1, channels = 2 } = {}) => {
  const frames = Math.floor(seconds * sampleRate);
  const bytesPerSample = 2;
  const dataBytes = frames * channels * bytesPerSample;
  const wav = Buffer.alloc(44 + dataBytes);

  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  wav.writeUInt16LE(channels * bytesPerSample, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataBytes, 40);

  for (let frame = 0; frame < frames; frame += 1) {
    const sample = Math.round(Math.sin((frame / sampleRate) * Math.PI * 2 * 440) * 12000);
    for (let channel = 0; channel < channels; channel += 1) {
      wav.writeInt16LE(sample, 44 + (frame * channels + channel) * bytesPerSample);
    }
  }

  return { wav, frames, channels };
};

const runDecodePcmFixture = ({ fixturePath, fixture, sampleRate, label, exactBytes = true }) => {
  const frameBytes = fixture.channels * Float32Array.BYTES_PER_ELEMENT;
  const expectedBytes = fixture.frames * frameBytes;
  const result = spawnSync(hostPath, ['-decode-pcm', fixturePath, '-sr', String(sampleRate), '-ch', String(fixture.channels)], {
    cwd: projectRoot,
    encoding: 'buffer',
    maxBuffer: expectedBytes + sampleRate * frameBytes,
  });
  const stderr = result.stderr?.toString('utf8') ?? '';
  const stdout = result.stdout ?? Buffer.alloc(0);

  if (result.status !== 0) {
    fail(`libav ${label} decode exited with ${result.status}; stderr=${stderr}; stdoutBytes=${stdout.length}`);
  }
  if (exactBytes && stdout.length !== expectedBytes) {
    fail(`libav ${label} returned ${stdout.length} bytes, expected ${expectedBytes}; stderr=${stderr}`);
  }
  if (!exactBytes && (stdout.length <= 0 || stdout.length % frameBytes !== 0)) {
    fail(`libav ${label} returned invalid f32le byte count ${stdout.length}; stderr=${stderr}`);
  }
  console.log(`[smoke:audio-host] libav ${label} decode PCM OK`);
};

const tempDir = mkdtempSync(join(tmpdir(), 'echo-libav-decode-'));
const wavPath = join(tempDir, 'decode.wav');
const flacPath = join(tempDir, 'decode.flac');
const mp3Path = join(tempDir, 'decode.mp3');
const fixture = createWav();

try {
  writeFileSync(wavPath, fixture.wav);
  runDecodePcmFixture({ fixturePath: wavPath, fixture, sampleRate: 48000, label: 'WAV' });

  if (!existsSync(ffmpegPath)) {
    fail(`Missing pinned ffmpeg binary: ${ffmpegPath}. Run "npm run prepare:win-ffmpeg" first.`);
  }

  for (const [label, outputPath, encodeArgs, exactBytes] of [
    ['FLAC', flacPath, ['-i', wavPath, flacPath], true],
    ['MP3', mp3Path, ['-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '128k', mp3Path], false],
  ]) {
    const encode = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...encodeArgs], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    if (encode.status !== 0) {
      fail(`Failed to create ${label} fixture: ${encode.stderr ?? ''}`);
    }
    runDecodePcmFixture({ fixturePath: outputPath, fixture, sampleRate: 48000, label, exactBytes });
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

if (!existsSync(daemonFixturePath)) {
  fail(`Missing daemon playback fixture: ${daemonFixturePath}`);
}

const daemonResult = spawnSync(process.execPath, [
  daemonSmokePath,
  '--scenario', 'lifecycle',
  '--host', hostPath,
  '--file', daemonFixturePath,
  '--evidence-dir', daemonEvidenceDir,
], {
  cwd: projectRoot,
  encoding: 'utf8',
  timeout: 60000,
  maxBuffer: 4 * 1024 * 1024,
});

if (daemonResult.stdout) process.stdout.write(daemonResult.stdout);
if (daemonResult.stderr) process.stderr.write(daemonResult.stderr);
if (daemonResult.error || daemonResult.status !== 0) {
  fail(`daemon lifecycle smoke failed: ${daemonResult.error?.message ?? `exit ${daemonResult.status}`}`);
}

console.log('[smoke:audio-host] daemon session/open/pause/resume/position/stop/shutdown OK');

const remoteSourceResult = spawnSync(process.execPath, [
  daemonSmokePath,
  '--scenario', 'remote-source',
  '--host', hostPath,
  '--file', daemonFixturePath,
  '--evidence-dir', daemonEvidenceDir,
], {
  cwd: projectRoot,
  encoding: 'utf8',
  timeout: 60000,
  maxBuffer: 4 * 1024 * 1024,
});

if (remoteSourceResult.stdout) process.stdout.write(remoteSourceResult.stdout);
if (remoteSourceResult.stderr) process.stderr.write(remoteSourceResult.stderr);
if (remoteSourceResult.error || remoteSourceResult.status !== 0) {
  fail(`daemon remote-source smoke failed: ${remoteSourceResult.error?.message ?? `exit ${remoteSourceResult.status}`}`);
}

console.log('[smoke:audio-host] daemon HTTP Range/auth/seek/host-truth path OK');

const mainThreadStallResult = spawnSync(process.execPath, [
  daemonSmokePath,
  '--scenario', 'main-thread-stall',
  '--host', hostPath,
  '--file', daemonFixturePath,
  '--evidence-dir', daemonEvidenceDir,
], {
  cwd: projectRoot,
  encoding: 'utf8',
  timeout: 60000,
  maxBuffer: 4 * 1024 * 1024,
});

if (mainThreadStallResult.stdout) process.stdout.write(mainThreadStallResult.stdout);
if (mainThreadStallResult.stderr) process.stderr.write(mainThreadStallResult.stderr);
if (mainThreadStallResult.error || mainThreadStallResult.status !== 0) {
  fail(`daemon main-thread-stall smoke failed: ${mainThreadStallResult.error?.message ?? `exit ${mainThreadStallResult.status}`}`);
}

console.log('[smoke:audio-host] native playback survived a blocked Node control plane OK');

const queueAdvanceResult = spawnSync(process.execPath, [
  daemonSmokePath,
  '--scenario', 'queue-advance',
  '--host', hostPath,
  '--file', daemonFixturePath,
  '--evidence-dir', daemonEvidenceDir,
], {
  cwd: projectRoot,
  encoding: 'utf8',
  timeout: 60000,
  maxBuffer: 4 * 1024 * 1024,
});

if (queueAdvanceResult.stdout) process.stdout.write(queueAdvanceResult.stdout);
if (queueAdvanceResult.stderr) process.stderr.write(queueAdvanceResult.stderr);
if (queueAdvanceResult.error || queueAdvanceResult.status !== 0) {
  fail(`daemon queue-advance smoke failed: ${queueAdvanceResult.error?.message ?? `exit ${queueAdvanceResult.status}`}`);
}

console.log('[smoke:audio-host] daemon queue revision/identity/operation handoff OK');

const gaplessBoundaryResult = spawnSync(process.execPath, [
  daemonSmokePath,
  '--scenario', 'gapless-boundary',
  '--host', hostPath,
  '--file', daemonFixturePath,
  '--evidence-dir', daemonEvidenceDir,
], {
  cwd: projectRoot,
  encoding: 'utf8',
  timeout: 60000,
  maxBuffer: 4 * 1024 * 1024,
});

if (gaplessBoundaryResult.stdout) process.stdout.write(gaplessBoundaryResult.stdout);
if (gaplessBoundaryResult.stderr) process.stderr.write(gaplessBoundaryResult.stderr);
if (gaplessBoundaryResult.error || gaplessBoundaryResult.status !== 0) {
  fail(`daemon gapless-boundary smoke failed: ${gaplessBoundaryResult.error?.message ?? `exit ${gaplessBoundaryResult.status}`}`);
}

console.log('[smoke:audio-host] daemon real-PCM gapless boundary/identity handoff OK');
