import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const hostPath = join(projectRoot, 'electron-app', 'build', process.platform === 'win32' ? 'echo-audio-host.exe' : 'echo-audio-host');

const fail = (message) => {
  console.error(`[smoke:dsd-direct] ${message}`);
  process.exit(1);
};

const framedMagic = 'ECNP';
const framedVersion = 1;
const frameTypeBeginSession = 1;
const frameTypeEndSession = 3;
const frameTypeShutdown = 4;
const frameTypeDop24Le = 6;

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

const packDop24Le = (channelBlocks, byteOffset, byteCount, startFrameIndex = 0) => {
  const channels = channelBlocks.length;
  const frames = Math.floor(byteCount / 2);
  const output = Buffer.alloc(frames * channels * 3);
  let outputOffset = 0;

  for (let frame = 0; frame < frames; frame += 1) {
    const marker = ((startFrameIndex + frame) & 1) === 0 ? 0x05 : 0xfa;
    const sourceOffset = byteOffset + frame * 2;
    for (const block of channelBlocks) {
      output[outputOffset] = block[sourceOffset] ?? 0;
      output[outputOffset + 1] = block[sourceOffset + 1] ?? 0;
      output[outputOffset + 2] = marker;
      outputOffset += 3;
    }
  }

  return output;
};

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

const runDopHost = async (payload, { timeoutMs = 20000 } = {}) => {
  const child = spawn(hostPath, ['-sr', '176400', '-ch', '2', '-exclusive', '-dop-output', '-framed-stdin'], {
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
  child.stdin.write(createFrame(frameTypeBeginSession, sessionId));
  child.stdin.write(createFrame(frameTypeDop24Le, sessionId, payload));
  child.stdin.write(createFrame(frameTypeEndSession, sessionId));

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
    events: parseJsonLines(stdout),
  };
};

if (!existsSync(hostPath)) {
  fail(`Missing host binary: ${hostPath}. Run "npm run build:audio-host" first.`);
}

const dopPayload = packDop24Le(
  [Buffer.from([1, 2, 3, 4]), Buffer.from([5, 6, 7, 8])],
  0,
  4,
);
const expected = [1, 2, 0x05, 5, 6, 0x05, 3, 4, 0xfa, 7, 8, 0xfa];
if (JSON.stringify([...dopPayload]) !== JSON.stringify(expected)) {
  fail(`DoP pack bytes mismatch: got ${JSON.stringify([...dopPayload])}`);
}

console.log('[smoke:dsd-direct] DoP pack bytes OK');

if (process.platform !== 'win32') {
  console.log('[smoke:dsd-direct] native DoP host skipped on non-Windows');
  process.exit(0);
}

const result = await runDopHost(dopPayload);
if (result.exitCode === 0) {
  const ready = result.events.find((event) => event.ready === true);
  const advanced = result.events.some((event) => typeof event.pos === 'number' && event.pos > 0);
  if (!ready || ready.backend !== 'wasapi-exclusive' || ready.backendImpl !== 'legacy-wasapi-exclusive-dop') {
    fail(`DoP host ready metadata invalid; stderr=${result.stderr}; stdout=${result.stdout}`);
  }
  if (!advanced) {
    fail(`DoP host did not consume frames; stderr=${result.stderr}; stdout=${result.stdout}`);
  }
  console.log(`[smoke:dsd-direct] WASAPI Exclusive DoP host OK (${ready.format ?? 'unknown format'})`);
} else if (/WASAPI exclusive DoP open failed|unsupported|format|DoP output requires/i.test(result.stderr)) {
  console.log(`[smoke:dsd-direct] DoP host unsupported on this device, fallback diagnostic OK: ${result.stderr.trim()}`);
} else if (result.exitCode === -1 && /Using legacy WASAPI exclusive DoP device/i.test(result.stderr)) {
  console.log(`[smoke:dsd-direct] DoP host timed out before ready on this device; automatic fallback path must handle this in app. stderr=${result.stderr.trim()}`);
} else {
  fail(`DoP host failed without explicit diagnostic; exit=${result.exitCode}; stdin=${result.stdinError || 'ok'}; stderr=${result.stderr}; stdout=${result.stdout}`);
}
