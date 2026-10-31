import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const hostPath = join(projectRoot, 'electron-app', 'build', process.platform === 'win32' ? 'echo-audio-host.exe' : 'echo-audio-host');

const framedMagic = 'ECNP';
const framedVersion = 1;
const frameTypeBeginSession = 1;
const frameTypePcmF32Le = 2;
const frameTypeEndSession = 3;
const frameTypeShutdown = 4;
const frameTypeSetVolume = 5;

const fail = (message) => {
  console.error(`[stress:audio-host] ${message}`);
  process.exit(1);
};

if (!existsSync(hostPath)) {
  fail(`Missing host binary: ${hostPath}. Run "npm run build:audio-host" first.`);
}

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

const createPcm = ({ sampleRate, seconds, channels = 2, frequency = 440, gain = 0.018 }) => {
  const frames = Math.max(1, Math.floor(seconds * sampleRate));
  const pcm = Buffer.alloc(frames * channels * Float32Array.BYTES_PER_ELEMENT);

  for (let frame = 0; frame < frames; frame += 1) {
    const fade = Math.min(1, frame / Math.max(1, Math.floor(sampleRate * 0.005)));
    const sample = Math.sin((frame / sampleRate) * Math.PI * 2 * frequency) * gain * fade;
    for (let channel = 0; channel < channels; channel += 1) {
      pcm.writeFloatLE(sample, (frame * channels + channel) * Float32Array.BYTES_PER_ELEMENT);
    }
  }

  return pcm;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const writeFrame = (child, type, sessionId, payload = Buffer.alloc(0)) =>
  new Promise((resolve, reject) => {
    child.stdin.write(createFrame(type, sessionId, payload), (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const writeFrameInChunks = async (child, type, sessionId, payload, chunkBytes) => {
  const frame = createFrame(type, sessionId, payload);
  for (let offset = 0; offset < frame.length; offset += chunkBytes) {
    const chunk = frame.subarray(offset, Math.min(frame.length, offset + chunkBytes));
    await new Promise((resolve, reject) => {
      child.stdin.write(chunk, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    await delay(1);
  }
};

const writeVolume = (child, volume) => {
  const payload = Buffer.alloc(4);
  payload.writeFloatLE(volume, 0);
  return writeFrame(child, frameTypeSetVolume, 0, payload);
};

const runScenario = async ({
  name,
  args,
  sampleRate,
  timeoutMs = 20000,
  expectReady = true,
  allowOpenFailure = false,
  run,
}) => {
  const child = spawn(hostPath, [...args, '-framed-stdin'], {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const events = [];
  let stdout = '';
  let stderr = '';
  let lineBuffer = '';
  let ready = false;
  let shutdownAck = false;
  let endedCount = 0;
  let positionCount = 0;

  const waiters = [];
  const notify = () => {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (waiter.predicate()) {
        waiters.splice(index, 1);
        waiter.resolve();
      }
    }
  };
  const waitFor = (predicate, label, ms = timeoutMs) => {
    if (predicate()) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      };
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) {
          waiters.splice(index, 1);
        }
        reject(new Error(`${name} timed out waiting for ${label}`));
      }, ms);
      waiters.push(waiter);
    });
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    lineBuffer += chunk;
    for (;;) {
      const newlineIndex = lineBuffer.indexOf('\n');
      if (newlineIndex < 0) {
        break;
      }

      const line = lineBuffer.slice(0, newlineIndex).trim();
      lineBuffer = lineBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      try {
        const event = JSON.parse(line);
        events.push(event);
        if (event.ready === true) {
          ready = true;
        }
        if (event.event === 'shutdown-ack') {
          shutdownAck = true;
        }
        if (event.event === 'ended') {
          endedCount += 1;
        }
        if (typeof event.pos === 'number') {
          positionCount += 1;
        }
        notify();
      } catch {
        // Native host logs should stay on stderr, but tolerate stray stdout.
      }
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const exitPromise = new Promise((resolve) => {
    child.on('exit', (code) => resolve(code ?? 0));
  });

  const killTimer = setTimeout(() => {
    child.kill('SIGKILL');
  }, timeoutMs + 2000);

  try {
    await waitFor(() => ready || (!expectReady && (stderr.length > 0 || events.some((event) => event.event === 'error'))), 'ready', timeoutMs);
    if (!ready) {
      if (allowOpenFailure && /open failed|initialize failed|no output devices|ASIO/i.test(stderr + stdout)) {
        child.kill('SIGKILL');
        clearTimeout(killTimer);
        return { name, skipped: true, reason: 'host_open_failed', stdout, stderr, events };
      }
      throw new Error(`${name} did not become ready; stderr=${stderr}; stdout=${stdout}`);
    }

    await run({
      child,
      waitFor,
      getEndedCount: () => endedCount,
      getPositionCount: () => positionCount,
      sampleRate,
    });

    await writeFrame(child, frameTypeShutdown, 0);
    child.stdin.end();
    await waitFor(() => shutdownAck, 'shutdown-ack', 5000);
    const exitCode = await exitPromise;
    clearTimeout(killTimer);

    if (exitCode !== 0) {
      throw new Error(`${name} exited with ${exitCode}; stderr=${stderr}; stdout=${stdout}`);
    }

    return { name, skipped: false, stdout, stderr, events, positionCount, endedCount };
  } catch (error) {
    clearTimeout(killTimer);
    try {
      child.kill('SIGKILL');
    } catch {
      // Best-effort cleanup for stress failures.
    }
    throw new Error(`${error instanceof Error ? error.message : String(error)}; stderr=${stderr}; stdout=${stdout}`);
  }
};

const scenarios = [
  {
    name: 'shared_many_short_sessions',
    args: ['-sr', '48000', '-ch', '2', '-buffer', '2048', '-fifo-ms', '420', '-prebuffer-ms', '0'],
    sampleRate: 48000,
    run: async ({ child, waitFor, getPositionCount, sampleRate }) => {
      for (let index = 0; index < 24; index += 1) {
        const sessionId = index + 1;
        const positionBefore = getPositionCount();
        await writeFrame(child, frameTypeBeginSession, sessionId);
        await writeVolume(child, index % 2 === 0 ? 0.25 : 0.75);
        await writeFrame(child, frameTypePcmF32Le, sessionId, createPcm({
          sampleRate,
          seconds: 0.05 + (index % 4) * 0.005,
          frequency: 220 + index * 17,
        }));
        await writeFrame(child, frameTypeEndSession, sessionId);
        await waitFor(() => getPositionCount() > positionBefore, `position session ${sessionId}`, 5000);
      }
    },
  },
  {
    name: 'shared_fragmented_frames_and_seek_reset',
    args: ['-sr', '48000', '-ch', '2', '-buffer', '1024', '-fifo-ms', '250', '-prebuffer-ms', '0'],
    sampleRate: 48000,
    run: async ({ child, waitFor, getEndedCount, sampleRate }) => {
      await writeFrame(child, frameTypeBeginSession, 1);
      await writeFrameInChunks(child, frameTypePcmF32Le, 1, createPcm({ sampleRate, seconds: 0.08, frequency: 330 }), 37);
      await writeFrame(child, frameTypeBeginSession, 2);
      await writeFrame(child, frameTypePcmF32Le, 1, createPcm({ sampleRate, seconds: 0.05, frequency: 880 }));
      const before = getEndedCount();
      await writeFrameInChunks(child, frameTypePcmF32Le, 2, createPcm({ sampleRate, seconds: 0.12, frequency: 550 }), 113);
      await writeFrame(child, frameTypeEndSession, 2);
      await waitFor(() => getEndedCount() > before, 'ended reset session', 5000);
    },
  },
  {
    name: 'shared_empty_then_real_session',
    args: ['-sr', '44100', '-ch', '2', '-buffer', '512', '-fifo-ms', '160', '-prebuffer-ms', '0'],
    sampleRate: 44100,
    run: async ({ child, waitFor, getEndedCount, sampleRate }) => {
      await writeFrame(child, frameTypeBeginSession, 1);
      await writeFrame(child, frameTypeEndSession, 1);
      await delay(50);
      const before = getEndedCount();
      await writeFrame(child, frameTypeBeginSession, 2);
      await writeFrame(child, frameTypePcmF32Le, 2, createPcm({ sampleRate, seconds: 0.10, frequency: 660 }));
      await writeFrame(child, frameTypeEndSession, 2);
      await waitFor(() => getEndedCount() > before, 'ended after empty session', 5000);
    },
  },
  {
    name: 'shared_prebuffer_pressure',
    args: ['-sr', '48000', '-ch', '2', '-buffer', '4096', '-fifo-ms', '900', '-prebuffer-ms', '180', '-prebuffer-timeout-ms', '600'],
    sampleRate: 48000,
    run: async ({ child, waitFor, getPositionCount, getEndedCount, sampleRate }) => {
      const positionBefore = getPositionCount();
      const endedBefore = getEndedCount();
      await writeFrame(child, frameTypeBeginSession, 1);
      await writeFrame(child, frameTypePcmF32Le, 1, createPcm({ sampleRate, seconds: 0.03, frequency: 330 }));
      await delay(80);
      await writeFrame(child, frameTypePcmF32Le, 1, createPcm({ sampleRate, seconds: 0.25, frequency: 440 }));
      await writeFrame(child, frameTypeEndSession, 1);
      await waitFor(() => getPositionCount() > positionBefore, 'position after prebuffer', 5000);
      await waitFor(() => getEndedCount() > endedBefore, 'ended after prebuffer', 8000);
    },
  },
];

if (process.platform === 'win32') {
  scenarios.push({
    name: 'directsound_many_short_sessions',
    args: ['-sr', '48000', '-ch', '2', '-shared-backend', 'directsound', '-buffer', '256'],
    sampleRate: 48000,
    run: async ({ child, waitFor, getPositionCount, sampleRate }) => {
      for (let index = 0; index < 8; index += 1) {
        const sessionId = index + 1;
        const positionBefore = getPositionCount();
        await writeFrame(child, frameTypeBeginSession, sessionId);
        await writeFrame(child, frameTypePcmF32Le, sessionId, createPcm({ sampleRate, seconds: 0.06, frequency: 300 + index * 30 }));
        await writeFrame(child, frameTypeEndSession, sessionId);
        await waitFor(() => getPositionCount() > positionBefore, `DirectSound position ${sessionId}`, 5000);
      }
    },
  });

  scenarios.push({
    name: 'exclusive_short_session',
    args: ['-sr', '44100', '-ch', '2', '-exclusive', '-buffer', '512'],
    sampleRate: 44100,
    allowOpenFailure: true,
    run: async ({ child, waitFor, getEndedCount, sampleRate }) => {
      const before = getEndedCount();
      await writeFrame(child, frameTypeBeginSession, 1);
      await writeFrame(child, frameTypePcmF32Le, 1, createPcm({ sampleRate, seconds: 0.08, frequency: 500 }));
      await writeFrame(child, frameTypeEndSession, 1);
      await waitFor(() => getEndedCount() > before, 'exclusive ended', 5000);
    },
  });
}

const startedAt = Date.now();
const results = [];

for (const scenario of scenarios) {
  process.stdout.write(`[stress:audio-host] ${scenario.name} ... `);
  const result = await runScenario(scenario);
  results.push(result);
  if (result.skipped) {
    console.log(`SKIP (${result.reason})`);
  } else {
    console.log(`OK events=${result.events.length} pos=${result.positionCount} ended=${result.endedCount}`);
  }
}

const skipped = results.filter((result) => result.skipped).length;
const elapsedMs = Date.now() - startedAt;
console.log(`[stress:audio-host] completed ${results.length - skipped}/${results.length} scenario(s) in ${elapsedMs}ms${skipped ? `, skipped=${skipped}` : ''}`);
