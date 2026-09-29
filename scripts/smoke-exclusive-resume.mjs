import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const host = join(root, 'electron-app', 'build', 'echo-audio-host.exe');
const device = process.env.ECHO_EXCLUSIVE_DEVICE ?? '扬声器 (INZONE H6 Air)';
const mode = process.env.ECHO_SMOKE_OUTPUT_MODE === 'shared' ? 'shared' : 'exclusive';
const args = [
  '-sr', '48000', '-ch', '2', '-buffer', '4096', '-fifo-ms', '250', '-prebuffer-ms', '20',
  ...(mode === 'exclusive' ? ['-device', device, '-exclusive'] : []),
  '--rpc-stdin-fd', '3', '--rpc-stdout-fd', '4',
  '--pcm-input-fd', '5', '--no-stdin',
];
const child = spawn(host, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'], windowsHide: true });

const rpcIn = child.stdio[3];
const rpcOut = child.stdio[4];
const pcmIn = child.stdio[5];
let rpcPending = '';
let stdoutPending = '';
let stderr = '';
let nextId = 1;
const responses = [];
const events = [];

const consume = (chunk, pending, target) => {
  pending += chunk;
  while (pending.includes('\n')) {
    const end = pending.indexOf('\n');
    const line = pending.slice(0, end).trim();
    pending = pending.slice(end + 1);
    if (!line) continue;
    try { target.push({ at: performance.now(), value: JSON.parse(line) }); } catch {}
  }
  return pending;
};
rpcOut.setEncoding('utf8');
rpcOut.on('data', (chunk) => { rpcPending = consume(chunk, rpcPending, responses); });
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdoutPending = consume(chunk, stdoutPending, events); });
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => { stderr += chunk; });

const waitFor = async (predicate, timeoutMs, label) => {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const result = predicate();
    if (result) return result;
    if (child.exitCode !== null) throw new Error(`${label}: host exited ${child.exitCode}\n${stderr}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 2));
  }
  throw new Error(`${label}: timeout\n${stderr}`);
};
const call = async (method, params, timeoutMs = 5000) => {
  const id = nextId++;
  rpcIn.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  const response = await waitFor(() => responses.find((entry) => entry.value?.id === id)?.value, timeoutMs, method);
  if (response.error) throw new Error(`${method}: ${JSON.stringify(response.error)}`);
  return response.result;
};
const sine = (frames, hz) => {
  const output = Buffer.alloc(frames * 2 * 4);
  for (let frame = 0; frame < frames; frame += 1) {
    const value = Math.sin((frame * hz * Math.PI * 2) / 48000) * 0.15;
    output.writeFloatLE(value, frame * 8);
    output.writeFloatLE(value, frame * 8 + 4);
  }
  return output;
};
const writePcm = (buffer) => new Promise((resolveWrite, rejectWrite) => {
  pcmIn.write(buffer, (error) => error ? rejectWrite(error) : resolveWrite());
});

try {
  await waitFor(() => events.find((entry) => entry.value?.ready === true), 15000, 'exclusive ready');
  const eqState = await call('eq.setState', [{
    enabled: true,
    preampDb: -12,
    bands: [{ enabled: true, filterType: 'peaking', frequencyHz: 1000, gainDb: 6, q: 1 }],
  }]);
  if (eqState?.enabled !== true || Number(eqState?.preampDb) !== -12) {
    throw new Error(`native DSP state was not applied: ${JSON.stringify(eqState)}`);
  }
  await call('audio.sessionBegin', { sessionId: 1, sr: 48000, ch: 2, startPaused: false });
  const first = sine(48000, 440);
  await writePcm(first);
  await waitFor(() => events.find((entry) => Number(entry.value?.pos) >= 4800), 3000, 'first audible position');
  await call('audio.pause', { sessionId: 1 });
  const abortStarted = performance.now();
  await call('audio.sessionAbort', { sessionId: 1, pcmBytes: first.length });
  const abortMs = performance.now() - abortStarted;

  await call('audio.sessionBegin', { sessionId: 2, sr: 48000, ch: 2, startPaused: true });
  const secondStartedAt = performance.now();
  const second = sine(24000, 880);
  const secondWrite = writePcm(second);
  await new Promise((resolveWait) => setTimeout(resolveWait, 30));
  const premature = events.find((entry) => entry.at >= secondStartedAt && Number(entry.value?.pos) > 0);
  if (premature) throw new Error(`session 2 advanced while startPaused: ${premature.value.pos}`);

  const resumeStarted = performance.now();
  await call('audio.resume', { sessionId: 2 });
  const resumeMs = performance.now() - resumeStarted;
  const firstSecondPosition = await waitFor(
    () => events.find((entry) => entry.at >= resumeStarted && Number(entry.value?.pos) > 0),
    1000,
    'replacement audible position',
  );
  const firstAudioMs = firstSecondPosition.at - resumeStarted;
  await secondWrite;
  const positions = events
    .filter((entry) => entry.at >= firstSecondPosition.at && Number.isFinite(Number(entry.value?.pos)))
    .map((entry) => Number(entry.value.pos));
  for (let index = 1; index < positions.length; index += 1) {
    if (positions[index] < positions[index - 1]) throw new Error(`position rollback: ${positions[index - 1]} -> ${positions[index]}`);
  }
  console.log(JSON.stringify({ pass: true, mode, device: mode === 'exclusive' ? device : 'default', dspApplied: true, abortMs: Math.round(abortMs), resumeMs: Math.round(resumeMs), firstAudioMs: Math.round(firstAudioMs) }));
} finally {
  try { await call('rpc.shutdown', [], 1000); } catch {}
  pcmIn.destroy();
  rpcIn.destroy();
  if (child.exitCode === null) child.kill();
}
