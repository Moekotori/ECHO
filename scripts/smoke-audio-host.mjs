import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const hostPath = join(projectRoot, 'electron-app', 'build', process.platform === 'win32' ? 'echo-audio-host.exe' : 'echo-audio-host');
const ffmpegPath = join(projectRoot, 'electron-app', 'tools', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

const fail = (message) => {
  console.error(`[smoke:audio-host] ${message}`);
  process.exit(1);
};

if (!existsSync(hostPath)) {
  fail(`Missing host binary: ${hostPath}. Run "npm run build:audio-host" first.`);
}

const runList = (args) => spawnSync(hostPath, args, {
  cwd: projectRoot,
  encoding: 'utf8',
});

const parseDeviceLines = (stdout) => stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const parseJsonLines = (stdout) => stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const framedMagic = 'ECNP';
const framedVersion = 1;
const frameTypeBeginSession = 1;
const frameTypePcmF32Le = 2;
const frameTypeEndSession = 3;
const frameTypeShutdown = 4;
const decodeServerMagic = 'ECDS';
const decodeServerVersion = 1;
const decodeFrameTypeStart = 1;
const decodeFrameTypeShutdown = 3;
const decodeFrameTypeReady = 101;
const decodeFrameTypePcmF32Le = 102;
const decodeFrameTypeEnd = 103;
const decodeFrameTypeError = 104;

const normalizeExitCode = (code) =>
  typeof code === 'number' && code > 0x7fffffff ? code - 0x1_0000_0000 : code;

const createFrameHeader = (type, sessionId, payloadBytes) => {
  const header = Buffer.alloc(16);
  header.write(framedMagic, 0, 'ascii');
  header.writeUInt8(framedVersion, 4);
  header.writeUInt8(type, 5);
  header.writeUInt32LE(sessionId >>> 0, 8);
  header.writeUInt32LE(Math.max(0, payloadBytes) >>> 0, 12);
  return header;
};

const createFrame = (type, sessionId, payload = Buffer.alloc(0)) =>
  payload.length > 0
    ? Buffer.concat([createFrameHeader(type, sessionId, payload.length), payload])
    : createFrameHeader(type, sessionId, 0);

const createDecodeFrameHeader = (type, sessionId, payloadBytes) => {
  const header = Buffer.alloc(16);
  header.write(decodeServerMagic, 0, 'ascii');
  header.writeUInt8(decodeServerVersion, 4);
  header.writeUInt8(type, 5);
  header.writeUInt32LE(sessionId >>> 0, 8);
  header.writeUInt32LE(Math.max(0, payloadBytes) >>> 0, 12);
  return header;
};

const createDecodeFrame = (type, sessionId, payload = Buffer.alloc(0)) =>
  payload.length > 0
    ? Buffer.concat([createDecodeFrameHeader(type, sessionId, payload.length), payload])
    : createDecodeFrameHeader(type, sessionId, 0);

const createPcm = ({ sampleRate = 48000, seconds = 0.1, channels = 2 } = {}) => {
  const frames = Math.floor(seconds * sampleRate);
  const pcm = Buffer.alloc(frames * channels * Float32Array.BYTES_PER_ELEMENT);

  for (let frame = 0; frame < frames; frame += 1) {
    const sample = Math.sin((frame / sampleRate) * Math.PI * 2 * 440) * 0.02;
    for (let channel = 0; channel < channels; channel += 1) {
      pcm.writeFloatLE(sample, (frame * channels + channel) * Float32Array.BYTES_PER_ELEMENT);
    }
  }

  return pcm;
};

const createWav = ({ sampleRate = 48000, seconds = 0.1, channels = 2 } = {}) => {
  const frames = Math.floor(seconds * sampleRate);
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
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
  wav.writeUInt16LE(bitsPerSample, 34);
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
    fail(`JUCE ${label} decode smoke exited with ${result.status}; stderr=${stderr}; stdoutBytes=${stdout.length}`);
  }

  if (exactBytes && stdout.length !== expectedBytes) {
    fail(`JUCE ${label} decode smoke returned ${stdout.length} bytes, expected ${expectedBytes}; stderr=${stderr}`);
  }

  if (!exactBytes && (stdout.length <= 0 || stdout.length % frameBytes !== 0)) {
    fail(`JUCE ${label} decode smoke returned invalid f32le byte count ${stdout.length}; frameBytes=${frameBytes}; stderr=${stderr}`);
  }

  console.log(`[smoke:audio-host] JUCE ${label} decode PCM OK`);
};

const runDecodeServerFixtureSequence = async ({ fixtures, sampleRate }) => {
  const child = spawn(hostPath, ['-decode-server'], {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let pending = Buffer.alloc(0);
  let stderr = '';
  let stdinError = '';
  let sessionId = 0;
  const sessions = new Map();

  const rejectAll = (error) => {
    for (const session of sessions.values()) {
      session.reject(error);
    }
    sessions.clear();
  };

  const parseFrames = () => {
    while (pending.length >= 16) {
      if (pending.toString('ascii', 0, 4) !== decodeServerMagic) {
        rejectAll(new Error(`invalid decode server magic; stderr=${stderr}`));
        child.kill('SIGKILL');
        return;
      }

      const version = pending.readUInt8(4);
      if (version !== decodeServerVersion) {
        rejectAll(new Error(`unsupported decode server version ${version}; stderr=${stderr}`));
        child.kill('SIGKILL');
        return;
      }

      const type = pending.readUInt8(5);
      const activeSessionId = pending.readUInt32LE(8);
      const payloadBytes = pending.readUInt32LE(12);
      if (pending.length < 16 + payloadBytes) {
        return;
      }

      const payload = pending.subarray(16, 16 + payloadBytes);
      pending = pending.subarray(16 + payloadBytes);
      const session = sessions.get(activeSessionId);
      if (!session) {
        continue;
      }

      if (type === decodeFrameTypeReady) {
        session.ready = true;
      } else if (type === decodeFrameTypePcmF32Le) {
        session.pcmBytes += payload.length;
      } else if (type === decodeFrameTypeEnd) {
        sessions.delete(activeSessionId);
        session.resolve(session);
      } else if (type === decodeFrameTypeError) {
        sessions.delete(activeSessionId);
        session.reject(new Error(`decode server error for ${session.label}: ${payload.toString('utf8')}; stderr=${stderr}`));
      }
    }
  };

  child.stdout.on('data', (chunk) => {
    pending = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk;
    parseFrames();
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdin.on('error', (error) => {
    stdinError = error instanceof Error ? error.message : String(error);
  });
  child.once('exit', (code) => {
    if (sessions.size > 0) {
      rejectAll(new Error(`decode server exited with ${code}; stderr=${stderr}; stdinError=${stdinError}`));
    }
  });

  const decode = async ({ fixturePath, fixture, label, exactBytes = true }) => {
    const activeSessionId = ++sessionId;
    const frameBytes = fixture.channels * Float32Array.BYTES_PER_ELEMENT;
    const expectedBytes = fixture.frames * frameBytes;
    const session = {
      label,
      ready: false,
      pcmBytes: 0,
      resolve: null,
      reject: null,
    };
    const promise = new Promise((resolve, reject) => {
      session.resolve = resolve;
      session.reject = reject;
    });
    sessions.set(activeSessionId, session);

    const timer = setTimeout(() => {
      sessions.delete(activeSessionId);
      session.reject(new Error(`decode server timed out for ${label}; stderr=${stderr}; stdinError=${stdinError}`));
    }, 10000);

    const payload = Buffer.from(JSON.stringify({
      filePath: fixturePath,
      startSeconds: 0,
      sampleRate,
      channels: fixture.channels,
    }), 'utf8');
    child.stdin.write(createDecodeFrame(decodeFrameTypeStart, activeSessionId, payload), (error) => {
      if (error) {
        sessions.delete(activeSessionId);
        session.reject(error);
      }
    });

    const result = await promise.finally(() => clearTimeout(timer));
    if (!result.ready) {
      fail(`decode server ${label} did not report ready; stderr=${stderr}`);
    }
    if (exactBytes && result.pcmBytes !== expectedBytes) {
      fail(`decode server ${label} returned ${result.pcmBytes} bytes, expected ${expectedBytes}; stderr=${stderr}`);
    }
    if (!exactBytes && (result.pcmBytes <= 0 || result.pcmBytes % frameBytes !== 0)) {
      fail(`decode server ${label} returned invalid f32le byte count ${result.pcmBytes}; frameBytes=${frameBytes}; stderr=${stderr}`);
    }
  };

  try {
    for (const fixture of fixtures) {
      await decode(fixture);
    }
  } finally {
    if (!child.stdin.destroyed && !child.stdin.writableEnded) {
      child.stdin.write(createDecodeFrame(decodeFrameTypeShutdown, 0));
      child.stdin.end();
    }
  }

  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(-1);
    }, 10000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? 0);
    });
  });

  if (exitCode !== 0) {
    fail(`decode server exited with ${exitCode}; stderr=${stderr}; stdinError=${stdinError}`);
  }

  console.log(`[smoke:audio-host] resident JUCE decode server OK (${fixtures.length} requests, pid ${child.pid ?? 'n/a'})`);
};

const runJuceDecodeSmoke = async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'echo-juce-decode-'));
  const wavPath = join(tempDir, 'juce-decode-smoke.wav');
  const flacPath = join(tempDir, 'juce-decode-smoke.flac');
  const mp3Path = join(tempDir, 'juce-decode-smoke.mp3');
  const sampleRate = 48000;
  const fixture = createWav({ sampleRate, seconds: 0.1, channels: 2 });

  try {
    writeFileSync(wavPath, fixture.wav);
    runDecodePcmFixture({ fixturePath: wavPath, fixture, sampleRate, label: 'WAV' });

    if (!existsSync(ffmpegPath)) {
      fail(`Missing ffmpeg binary for compressed decode fixture generation: ${ffmpegPath}`);
    }

    const flacEncode = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', wavPath, flacPath], {
      cwd: projectRoot,
      encoding: 'utf8',
    });

    if (flacEncode.status !== 0) {
      fail(`Failed to create FLAC decode fixture with ffmpeg; stderr=${flacEncode.stderr ?? ''}`);
    }

    runDecodePcmFixture({ fixturePath: flacPath, fixture, sampleRate, label: 'FLAC' });

    const mp3Encode = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '128k', mp3Path], {
      cwd: projectRoot,
      encoding: 'utf8',
    });

    if (mp3Encode.status !== 0) {
      fail(`Failed to create MP3 decode fixture with ffmpeg; stderr=${mp3Encode.stderr ?? ''}`);
    }

    runDecodePcmFixture({ fixturePath: mp3Path, fixture, sampleRate, label: 'MP3', exactBytes: false });
    await runDecodeServerFixtureSequence({
      sampleRate,
      fixtures: [
        { fixturePath: wavPath, fixture, label: 'WAV' },
        { fixturePath: flacPath, fixture, label: 'FLAC' },
        { fixturePath: mp3Path, fixture, label: 'MP3', exactBytes: false },
      ],
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
};

const runPcmHost = async (args, { timeoutMs = 15000, sampleRate = 48000, seconds = 0.1, env = undefined } = {}) => {
  const startedAt = Date.now();
  const child = spawn(hostPath, args, {
    cwd: projectRoot,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let stdinError = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  child.stdin.on('error', (error) => {
    stdinError = error instanceof Error ? error.message : String(error);
  });

  const pcm = createPcm({ sampleRate, seconds });

  child.stdin.write(pcm, (error) => {
    if (error) {
      stdinError = error.message;
    }
  });
  child.stdin.end();

  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(-1);
    }, timeoutMs);

    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? 0);
    });
  });

  return {
    exitCode,
    elapsedMs: Date.now() - startedAt,
    stdout,
    stderr,
    stdinError,
    events: parseJsonLines(stdout),
  };
};

const runFramedPcmHost = async (args, { timeoutMs = 15000, sampleRate = 48000, seconds = 0.1 } = {}) => {
  const child = spawn(hostPath, [...args, '-framed-stdin'], {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let stdinError = '';
  let shutdownSent = false;

  const sendShutdown = () => {
    if (shutdownSent || child.stdin.destroyed || child.stdin.writableEnded || !child.stdin.writable) {
      return;
    }

    shutdownSent = true;
    child.stdin.write(createFrame(frameTypeShutdown, 0), (error) => {
      if (error) {
        stdinError = error.message;
      }
      child.stdin.end();
    });
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (stdout.includes('"event":"ended"')) {
      sendShutdown();
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  child.stdin.on('error', (error) => {
    stdinError = error instanceof Error ? error.message : String(error);
  });

  const sessionId = 1;
  const pcm = createPcm({ sampleRate, seconds });
  child.stdin.write(createFrame(frameTypeBeginSession, sessionId), (error) => {
    if (error) {
      stdinError = error.message;
    }
  });
  child.stdin.write(createFrame(frameTypePcmF32Le, sessionId, pcm), (error) => {
    if (error) {
      stdinError = error.message;
    }
  });
  child.stdin.write(createFrame(frameTypeEndSession, sessionId), (error) => {
    if (error) {
      stdinError = error.message;
    }
  });

  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(-1);
    }, timeoutMs);

    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? 0);
    });
  });

  return {
    exitCode,
    stdout,
    stderr,
    stdinError,
    shutdownSent,
    events: parseJsonLines(stdout),
  };
};

const assertNoSharedFallback = (label, result) => {
  if (result.stdout.includes('"backend":"wasapi-shared"') || result.stdout.includes('"exclusive":false,"backend":"wasapi-shared"')) {
    fail(`${label} fell back to shared output; stderr=${result.stderr}; stdout=${result.stdout}`);
  }
};

const hasAdvancedPosition = (events) => events.some((event) => typeof event.pos === 'number' && event.pos > 0);

const hasReadyBufferTelemetry = (event) =>
  event &&
  typeof event.deviceBufferFrames === 'number' &&
  typeof event.nativeActualBufferFrames === 'number' &&
  typeof event.actualBufferFrames === 'number' &&
  typeof event.requestedDeviceBufferFrames === 'number' &&
  typeof event.openedDeviceBufferFrames === 'number' &&
  typeof event.bufferSizeFallback === 'boolean';

const listResult = runList(['-list']);

if (listResult.status !== 0) {
  fail(`-list failed: ${listResult.stderr || listResult.stdout}`);
}

const devices = parseDeviceLines(listResult.stdout);

if (devices.length === 0) {
  fail('-list returned no output devices');
}

console.log(`[smoke:audio-host] listed ${devices.length} output devices`);

await runJuceDecodeSmoke();

if (process.platform === 'win32') {
  const initTimeoutResult = await runPcmHost(['-sr', '48000', '-ch', '2'], {
    timeoutMs: 6000,
    sampleRate: 48000,
    seconds: 0.01,
    env: { ECHO_TEST_WASAPI_INITIALIZE_HANG_MS: '5000' },
  });
  const initTimeoutExitCode = normalizeExitCode(initTimeoutResult.exitCode);

  if (initTimeoutExitCode !== -3) {
    fail(`WASAPI initialize timeout exited with ${initTimeoutResult.exitCode}; stderr=${initTimeoutResult.stderr}; stdout=${initTimeoutResult.stdout}`);
  }

  if (initTimeoutResult.elapsedMs >= 3500) {
    fail(`WASAPI initialize timeout took ${initTimeoutResult.elapsedMs}ms; stderr=${initTimeoutResult.stderr}; stdout=${initTimeoutResult.stdout}`);
  }

  if (!/WASAPI Initialize timed out after 3000ms phase=initialize/u.test(initTimeoutResult.stderr)) {
    fail(`WASAPI initialize timeout missing diagnostic; stderr=${initTimeoutResult.stderr}; stdout=${initTimeoutResult.stdout}`);
  }

  console.log(`[smoke:audio-host] WASAPI initialize timeout fail-fast OK (${initTimeoutResult.elapsedMs}ms)`);

  const activateTimeoutResult = await runPcmHost(['-sr', '48000', '-ch', '2'], {
    timeoutMs: 6000,
    sampleRate: 48000,
    seconds: 0.01,
    env: { ECHO_TEST_WASAPI_ACTIVATE_HANG_MS: '5000' },
  });
  const activateTimeoutExitCode = normalizeExitCode(activateTimeoutResult.exitCode);

  if (activateTimeoutExitCode !== -3) {
    fail(`WASAPI activate timeout exited with ${activateTimeoutResult.exitCode}; stderr=${activateTimeoutResult.stderr}; stdout=${activateTimeoutResult.stdout}`);
  }

  if (activateTimeoutResult.elapsedMs >= 3500) {
    fail(`WASAPI activate timeout took ${activateTimeoutResult.elapsedMs}ms; stderr=${activateTimeoutResult.stderr}; stdout=${activateTimeoutResult.stdout}`);
  }

  if (!/WASAPI Activate timed out after 3000ms phase=activate/u.test(activateTimeoutResult.stderr)) {
    fail(`WASAPI activate timeout missing diagnostic; stderr=${activateTimeoutResult.stderr}; stdout=${activateTimeoutResult.stdout}`);
  }

  console.log(`[smoke:audio-host] WASAPI activate timeout fail-fast OK (${activateTimeoutResult.elapsedMs}ms)`);
}

const sharedResult = await runPcmHost(['-sr', '48000', '-ch', '2'], {
  timeoutMs: 10000,
  sampleRate: 48000,
  seconds: 0.25,
});

if (sharedResult.exitCode !== 0) {
  fail(`shared host exited with ${sharedResult.exitCode}; stdin=${sharedResult.stdinError || 'ok'}; stderr=${sharedResult.stderr}; stdout=${sharedResult.stdout}`);
}

const sharedReady = sharedResult.events.find((event) => event.ready === true);
let ready = Boolean(sharedReady);
let position = sharedResult.events.some((event) => typeof event.pos === 'number');
let ended = sharedResult.events.some((event) => event.event === 'ended');
let telemetry = sharedResult.events.some((event) =>
  typeof event.pos === 'number' &&
  typeof event.bufferedFrames === 'number' &&
  typeof event.underrunCallbacks === 'number' &&
  typeof event.underrunFrames === 'number'
);

if (!ready || !position || !telemetry || !ended || !hasReadyBufferTelemetry(sharedReady)) {
  fail(`missing expected shared events ready=${ready} bufferTelemetry=${hasReadyBufferTelemetry(sharedReady)} position=${position} telemetry=${telemetry} ended=${ended}; stderr=${sharedResult.stderr}; stdout=${sharedResult.stdout}`);
}

console.log('[smoke:audio-host] shared ready/position/telemetry/ended OK');

if (process.platform === 'win32') {
  const invalidateResult = await runPcmHost(['-sr', '48000', '-ch', '2'], {
    timeoutMs: 15000,
    sampleRate: 48000,
    seconds: 1,
    env: { ECHO_TEST_WASAPI_SHARED_INVALIDATE_AFTER_MS: '200' },
  });

  if (invalidateResult.exitCode !== 0) {
    fail(`shared invalidate host exited with ${invalidateResult.exitCode}; stdin=${invalidateResult.stdinError || 'ok'}; stderr=${invalidateResult.stderr}; stdout=${invalidateResult.stdout}`);
  }

  const invalidateReady = invalidateResult.events.find((event) => event.ready === true);
  const invalidateEnded = invalidateResult.events.some((event) => event.event === 'ended');
  if (!invalidateReady || !invalidateEnded || !/WASAPI shared test-invalidation reported recoverable error/u.test(invalidateResult.stderr) || !/WASAPI shared audio client rebuilt/u.test(invalidateResult.stderr)) {
    fail(`shared invalidate recovery missing expected signals; ready=${Boolean(invalidateReady)} ended=${invalidateEnded}; stderr=${invalidateResult.stderr}; stdout=${invalidateResult.stdout}`);
  }

  console.log('[smoke:audio-host] shared invalidation rebuild recovery OK');
}

const framedSharedResult = await runFramedPcmHost(['-sr', '48000', '-ch', '2'], {
  timeoutMs: 10000,
  sampleRate: 48000,
  seconds: 0.25,
});

if (framedSharedResult.exitCode !== 0) {
  fail(`framed shared host exited with ${framedSharedResult.exitCode}; stdin=${framedSharedResult.stdinError || 'ok'}; stderr=${framedSharedResult.stderr}; stdout=${framedSharedResult.stdout}`);
}

const framedSharedReady = framedSharedResult.events.find((event) => event.ready === true);
ready = Boolean(framedSharedReady);
position = framedSharedResult.events.some((event) => typeof event.pos === 'number');
ended = framedSharedResult.events.some((event) => event.event === 'ended');
const shutdownAck = framedSharedResult.events.some((event) => event.event === 'shutdown-ack');
telemetry = framedSharedResult.events.some((event) =>
  typeof event.pos === 'number' &&
  typeof event.bufferedFrames === 'number' &&
  typeof event.underrunCallbacks === 'number' &&
  typeof event.underrunFrames === 'number'
);

if (!ready || !position || !telemetry || !ended || !shutdownAck || !hasReadyBufferTelemetry(framedSharedReady)) {
  fail(`missing expected framed shared events ready=${ready} bufferTelemetry=${hasReadyBufferTelemetry(framedSharedReady)} position=${position} telemetry=${telemetry} ended=${ended} shutdownAck=${shutdownAck}; stdin=${framedSharedResult.stdinError || 'ok'}; stderr=${framedSharedResult.stderr}; stdout=${framedSharedResult.stdout}`);
}

console.log('[smoke:audio-host] framed stdin ready/position/telemetry/ended/shutdown OK');

if (process.platform === 'win32') {
  const directSoundResult = await runPcmHost(['-sr', '48000', '-ch', '2', '-shared-backend', 'directsound'], {
    timeoutMs: 10000,
    sampleRate: 48000,
    seconds: 0.25,
  });
  const directSoundReady = directSoundResult.events.find((event) => event.ready === true);
  const directSoundPosition = directSoundResult.events.some((event) => typeof event.pos === 'number');
  const directSoundEnded = directSoundResult.events.some((event) => event.event === 'ended');

  if (directSoundResult.exitCode !== 0) {
    fail(`DirectSound shared host exited with ${directSoundResult.exitCode}; stdin=${directSoundResult.stdinError || 'ok'}; stderr=${directSoundResult.stderr}; stdout=${directSoundResult.stdout}`);
  }

  if (
    !directSoundReady ||
    directSoundReady.backend !== 'directsound-shared' ||
    !directSoundPosition ||
    !directSoundEnded ||
    !hasReadyBufferTelemetry(directSoundReady)
  ) {
    fail(`missing expected DirectSound shared events ready=${Boolean(directSoundReady)} bufferTelemetry=${hasReadyBufferTelemetry(directSoundReady)} position=${directSoundPosition} ended=${directSoundEnded}; stderr=${directSoundResult.stderr}; stdout=${directSoundResult.stdout}`);
  }

  console.log('[smoke:audio-host] DirectSound shared ready/position/ended OK');
}

const asioListResult = runList(['-list', '-asio']);
const asioDevices = parseDeviceLines(asioListResult.stdout);

if (asioListResult.status === 0) {
  console.log(`[smoke:audio-host] ASIO list returned ${asioDevices.length} device(s)`);
} else {
  const diagnostic = `${asioListResult.stderr || ''}${asioListResult.stdout || ''}`;
  if (!/ASIO/i.test(diagnostic)) {
    fail(`-list -asio failed without ASIO diagnostic: ${diagnostic}`);
  }
  console.log(`[smoke:audio-host] ASIO list diagnostic OK: ${diagnostic.trim()}`);
}

const exclusiveResult = await runPcmHost(['-sr', '44100', '-ch', '2', '-exclusive'], {
  timeoutMs: 60000,
  sampleRate: 44100,
  seconds: 0.1,
});
const exclusiveReady = exclusiveResult.events.find((event) => event.ready === true);
assertNoSharedFallback('exclusive smoke', exclusiveResult);

if (exclusiveResult.exitCode === 0) {
  if (!exclusiveReady || exclusiveReady.exclusive !== true || exclusiveReady.backend !== 'wasapi-exclusive') {
    fail(`exclusive ready metadata invalid; stderr=${exclusiveResult.stderr}; stdout=${exclusiveResult.stdout}`);
  }
  if (!hasReadyBufferTelemetry(exclusiveReady)) {
    fail(`exclusive ready buffer telemetry invalid; stderr=${exclusiveResult.stderr}; stdout=${exclusiveResult.stdout}`);
  }
  if (!hasAdvancedPosition(exclusiveResult.events)) {
    fail(`exclusive did not consume PCM frames; stderr=${exclusiveResult.stderr}; stdout=${exclusiveResult.stdout}`);
  }
  console.log(`[smoke:audio-host] exclusive ready OK (${exclusiveReady.deviceType ?? 'unknown device type'})`);
} else if (!/WASAPI exclusive open failed/i.test(exclusiveResult.stderr)) {
  fail(`exclusive failed without explicit diagnostic; exit=${exclusiveResult.exitCode}; stderr=${exclusiveResult.stderr}; stdout=${exclusiveResult.stdout}`);
} else {
  console.log('[smoke:audio-host] exclusive failure diagnostic OK');
}

if (asioListResult.status === 0 && asioDevices.length > 0) {
  const asioResult = await runPcmHost(['-sr', '44100', '-ch', '2', '-asio'], {
    timeoutMs: 30000,
    sampleRate: 44100,
    seconds: 0.1,
  });
  const asioReady = asioResult.events.find((event) => event.ready === true);
  assertNoSharedFallback('ASIO smoke', asioResult);

  if (asioResult.exitCode === 0) {
    if (!asioReady || asioReady.backend !== 'asio' || asioReady.exclusive !== false) {
      fail(`ASIO ready metadata invalid; stderr=${asioResult.stderr}; stdout=${asioResult.stdout}`);
    }
    if (!hasReadyBufferTelemetry(asioReady)) {
      fail(`ASIO ready buffer telemetry invalid; stderr=${asioResult.stderr}; stdout=${asioResult.stdout}`);
    }
    if (!hasAdvancedPosition(asioResult.events)) {
      fail(`ASIO did not consume PCM frames; stderr=${asioResult.stderr}; stdout=${asioResult.stdout}`);
    }
    console.log(`[smoke:audio-host] ASIO ready OK (${asioReady.deviceName ?? 'unknown device'})`);
  } else if (!/ASIO open failed/i.test(asioResult.stderr)) {
    fail(`ASIO failed without explicit diagnostic; exit=${asioResult.exitCode}; stderr=${asioResult.stderr}; stdout=${asioResult.stdout}`);
  } else {
    console.log('[smoke:audio-host] ASIO failure diagnostic OK');
  }
}
