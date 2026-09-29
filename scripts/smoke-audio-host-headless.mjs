import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const hostPath = process.env.ECHO_AUDIO_HOST_PATH
  ? resolve(projectRoot, process.env.ECHO_AUDIO_HOST_PATH)
  : join(projectRoot, 'electron-app', 'build', process.platform === 'win32' ? 'echo-audio-host.exe' : 'echo-audio-host');
const ffmpegPath = process.env.ECHO_FFMPEG_PATH
  ?? (process.platform === 'win32'
    ? join(projectRoot, 'electron-app', 'tools', 'ffmpeg.exe')
    : 'ffmpeg');
const evidencePath = join(projectRoot, 'out', 'native-audio-headless-smoke.json');

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

const waitFor = async (predicate, message, timeoutMs = 10000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(message);
};

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

  return { wav, frames, channels, sampleRate };
};

const decodeFixture = ({ fixturePath, fixture, label, exactBytes }) => {
  const frameBytes = fixture.channels * Float32Array.BYTES_PER_ELEMENT;
  const expectedBytes = fixture.frames * frameBytes;
  const result = spawnSync(
    hostPath,
    ['-decode-pcm', fixturePath, '-sr', String(fixture.sampleRate), '-ch', String(fixture.channels)],
    {
      cwd: projectRoot,
      encoding: 'buffer',
      maxBuffer: expectedBytes + fixture.sampleRate * frameBytes,
    },
  );
  const stdout = result.stdout ?? Buffer.alloc(0);
  const stderr = result.stderr?.toString('utf8') ?? '';

  if (result.error || result.status !== 0) {
    throw new Error(`${label} decode failed: ${result.error?.message ?? (stderr || `exit ${result.status}`)}`);
  }
  if (exactBytes && stdout.length !== expectedBytes) {
    throw new Error(`${label} decode returned ${stdout.length} bytes; expected ${expectedBytes}`);
  }
  if (!exactBytes && (stdout.length === 0 || stdout.length % frameBytes !== 0)) {
    throw new Error(`${label} decode returned invalid f32le byte count ${stdout.length}`);
  }

  return { label, bytes: stdout.length, expectedBytes: exactBytes ? expectedBytes : null };
};

const encodeFixture = (inputPath, outputPath, args, label) => {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath, ...args, outputPath], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} fixture encode failed: ${result.error?.message ?? (result.stderr || `exit ${result.status}`)}`);
  }
};

const runDeferredDaemonLifecycle = async () => {
  const child = spawn(
    hostPath,
    ['--no-stdin', '--defer-device-open', '--rpc-stdin-fd', '3', '--rpc-stdout-fd', '4'],
    {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  let rpcBuffer = '';
  const rpcMessages = [];
  const rpcInput = child.stdio[3];
  const rpcOutput = child.stdio[4];

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  rpcOutput.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  rpcOutput.on('data', (chunk) => {
    rpcBuffer += chunk;
    while (rpcBuffer.includes('\n')) {
      const newline = rpcBuffer.indexOf('\n');
      const line = rpcBuffer.slice(0, newline).trim();
      rpcBuffer = rpcBuffer.slice(newline + 1);
      if (!line) continue;
      rpcMessages.push(JSON.parse(line));
    }
  });

  const sendRpc = (id, method) => {
    rpcInput.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: {} })}\n`);
  };

  try {
    await waitFor(
      () => stdout.includes('"readyLevel":"process"') && stderr.includes('awaiting JSON-RPC commands'),
      `daemon process-ready timeout; stdout=${stdout}; stderr=${stderr}`,
    );

    sendRpc(1, 'rpc.ping');
    const ping = await waitFor(
      () => rpcMessages.find((message) => message?.id === 1),
      `rpc.ping timeout; rpc=${JSON.stringify(rpcMessages)}; stderr=${stderr}`,
    );
    if (ping.result !== 'pong') {
      throw new Error(`rpc.ping returned ${JSON.stringify(ping)}`);
    }

    sendRpc(2, 'rpc.shutdown');
    const shutdown = await waitFor(
      () => rpcMessages.find((message) => message?.id === 2),
      `rpc.shutdown timeout; rpc=${JSON.stringify(rpcMessages)}; stderr=${stderr}`,
    );
    if (shutdown.result !== 'ok') {
      throw new Error(`rpc.shutdown returned ${JSON.stringify(shutdown)}`);
    }

    await waitFor(
      () => child.exitCode !== null || child.signalCode !== null,
      `daemon did not exit after rpc.shutdown; stderr=${stderr}`,
      5000,
    );
    if (child.exitCode !== 0 || child.signalCode !== null) {
      throw new Error(`daemon exited abnormally: exit=${child.exitCode} signal=${child.signalCode}; stderr=${stderr}`);
    }

    return {
      processReady: true,
      ping: ping.result,
      shutdown: shutdown.result,
      exitCode: child.exitCode,
      signalCode: child.signalCode,
    };
  } finally {
    try { rpcInput.end(); } catch { /* best effort */ }
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
};

const tempDir = mkdtempSync(join(tmpdir(), 'echo-native-headless-'));
const evidence = { hostPath, ffmpegPath, decode: [], daemon: null };

try {
  if (!existsSync(hostPath)) {
    throw new Error(`Missing host binary: ${hostPath}`);
  }
  const ffmpegVersion = spawnSync(ffmpegPath, ['-version'], { cwd: projectRoot, encoding: 'utf8' });
  if (ffmpegVersion.error || ffmpegVersion.status !== 0) {
    throw new Error(`FFmpeg is unavailable: ${ffmpegVersion.error?.message ?? ffmpegVersion.stderr}`);
  }

  const fixture = createWav();
  const wavPath = join(tempDir, 'decode.wav');
  const flacPath = join(tempDir, 'decode.flac');
  const mp3Path = join(tempDir, 'decode.mp3');
  writeFileSync(wavPath, fixture.wav);

  evidence.decode.push(decodeFixture({ fixturePath: wavPath, fixture, label: 'WAV', exactBytes: true }));
  encodeFixture(wavPath, flacPath, [], 'FLAC');
  evidence.decode.push(decodeFixture({ fixturePath: flacPath, fixture, label: 'FLAC', exactBytes: true }));
  encodeFixture(wavPath, mp3Path, ['-codec:a', 'libmp3lame', '-b:a', '128k'], 'MP3');
  evidence.decode.push(decodeFixture({ fixturePath: mp3Path, fixture, label: 'MP3', exactBytes: false }));
  evidence.daemon = await runDeferredDaemonLifecycle();

  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log('[smoke:audio-host:headless] WAV/FLAC/MP3 native decode PASS');
  console.log('[smoke:audio-host:headless] deferred daemon ping/shutdown PASS');
  console.log(`[smoke:audio-host:headless] evidence: ${evidencePath}`);
} catch (error) {
  console.error(`[smoke:audio-host:headless] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
