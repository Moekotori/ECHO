import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostPath = process.env.ECHO_AUDIO_HOST_PATH
  ? resolve(projectRoot, process.env.ECHO_AUDIO_HOST_PATH)
  : join(projectRoot, 'electron-app', 'build', process.platform === 'win32' ? 'echo-audio-host.exe' : 'echo-audio-host');

if (!existsSync(hostPath)) {
  throw new Error(`Missing host binary: ${hostPath}. Run npm run build:audio-host first.`);
}

const child = spawn(hostPath, [
  '-sr', '48000',
  '-ch', '2',
  '-fifo-ms', '500',
  '-prebuffer-ms', '0',
  '--rpc-stdin-fd', '3',
  '--rpc-stdout-fd', '4',
  '--pcm-input-fd', '5',
  '--no-stdin',
], {
  cwd: projectRoot,
  stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

const rpcInput = child.stdio[3];
const rpcOutput = child.stdio[4];
const pcmInput = child.stdio[5];
const stdoutMessages = [];
const rpcMessages = [];
let stderr = '';
let stdoutPending = '';
let rpcPending = '';
let nextRpcId = 1;

const consumeLines = (chunk, pending, target) => {
  pending += chunk;
  while (pending.includes('\n')) {
    const index = pending.indexOf('\n');
    const line = pending.slice(0, index).trim();
    pending = pending.slice(index + 1);
    if (!line) continue;
    try {
      target.push({ message: JSON.parse(line), at: Date.now() });
    } catch {
      target.push({ message: line, at: Date.now() });
    }
  }
  return pending;
};

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdoutPending = consumeLines(chunk, stdoutPending, stdoutMessages);
});
rpcOutput.setEncoding('utf8');
rpcOutput.on('data', (chunk) => {
  rpcPending = consumeLines(chunk, rpcPending, rpcMessages);
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => { stderr += chunk; });

const waitFor = async (predicate, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    if (child.exitCode !== null) {
      throw new Error(`${label}: host exited with ${child.exitCode}\n${stderr}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`${label}: timed out after ${timeoutMs}ms\n${stderr}`);
};

const rpcCall = async (method, params, timeoutMs = 15000) => {
  const id = nextRpcId++;
  await new Promise((resolveWrite, rejectWrite) => {
    rpcInput.write(`${JSON.stringify({ jsonrpc: '2.0', method, params, id })}\n`, (error) => {
      if (error) rejectWrite(error);
      else resolveWrite();
    });
  });
  const response = await waitFor(
    () => rpcMessages.find((entry) => entry.message?.id === id)?.message,
    timeoutMs,
    method,
  );
  if (response.error) throw new Error(`${method}: ${JSON.stringify(response.error)}`);
  return response.result;
};

try {
  await waitFor(
    () => stdoutMessages.some((entry) => entry.message?.ready === true),
    15000,
    'process ready',
  );

  const sessionAccepted = await rpcCall('audio.sessionBegin', {
    sessionId: 1,
    sr: 48000,
    ch: 2,
    buffer: 512,
    fifoMs: 500,
    prebufferMs: 0,
  });
  if (sessionAccepted !== true) throw new Error('audio.sessionBegin was rejected');

  const frames = 24000;
  const pcm = Buffer.alloc(frames * 2 * Float32Array.BYTES_PER_ELEMENT);
  await new Promise((resolveWrite, rejectWrite) => {
    pcmInput.write(pcm, (error) => error ? rejectWrite(error) : resolveWrite());
  });

  const inputEndSentAt = Date.now();
  const inputEndAccepted = await rpcCall('audio.inputEnd', { sessionId: 1, pcmBytes: pcm.length });
  if (inputEndAccepted !== true) throw new Error('audio.inputEnd was rejected');

  const position = await waitFor(
    () => stdoutMessages.map((entry) => entry.message).find((message) => Number(message?.pos) > 0),
    10000,
    'PCM position advance',
  );
  await waitFor(
    () => stdoutMessages.some((entry) => entry.at >= inputEndSentAt && entry.message?.event === 'ended'),
    10000,
    'PCM drain ended',
  );

  console.log(`[smoke:pcm-bridge] PASS frames=${frames} finalObservedPos=${position.pos}`);
} finally {
  pcmInput.destroy();
  rpcInput.destroy();
  if (child.exitCode === null) child.kill('SIGTERM');
}
